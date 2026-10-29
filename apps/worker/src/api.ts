import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { PLATFORMS, type Platform } from "@rankkiln/connectors";
import { postSchema, siteProfileSchema } from "@rankkiln/core";
import { proposeProfile } from "@rankkiln/engine";
import { lint } from "@rankkiln/lint";
import { exchangeCode, gscAuthUrl, listProperties } from "@rankkiln/topics";
import {
  endSession,
  finishLogin,
  readState,
  SESSION_COOKIE,
  sessionCookie,
  sessionUser,
  signState,
  startLogin,
  type SessionUser,
} from "./auth";
import { checkoutUrl, portalUrl, readWebhook } from "./billing";
import { encrypt } from "./crypto";
import {
  all,
  exec,
  one,
  parseProfile,
  runInterval,
  siteConnector,
  type AccountRow,
  type ConnectionRow,
  type DraftRow,
  type SiteRow,
  type TopicRow,
} from "./db";
import { newId } from "./crypto";
import type { Env } from "./env";
import { month, planFor, PLANS } from "./plans";
import { defaultDeps, refreshTopics, type Deps } from "./run";

type App = { Bindings: Env; Variables: { user: SessionUser } };
type Ctx = Context<App>;

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 402,
    message: string,
  ) {
    super(message);
  }
}

async function body<T>(c: Ctx): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HttpError(400, "Send JSON.");
  }
}

async function ownSite(c: Ctx, id: string): Promise<SiteRow> {
  const site = await one<SiteRow>(
    c.env.DB,
    "SELECT * FROM sites WHERE id = ? AND account_id = ?",
    id,
    c.get("user").accountId,
  );
  if (!site) throw new HttpError(404, "No such site.");
  return site;
}

async function ownDraft(c: Ctx, id: string): Promise<DraftRow> {
  const draft = await one<DraftRow>(
    c.env.DB,
    "SELECT d.* FROM drafts d JOIN sites s ON s.id = d.site_id WHERE d.id = ? AND s.account_id = ?",
    id,
    c.get("user").accountId,
  );
  if (!draft) throw new HttpError(404, "No such draft.");
  return draft;
}

const siteView = (s: SiteRow) => ({
  id: s.id,
  profile: JSON.parse(s.profile),
  paused: !!s.paused,
  nextRunAt: s.next_run_at,
  createdAt: s.created_at,
});

const draftView = (d: DraftRow) => ({
  id: d.id,
  siteId: d.site_id,
  slug: d.slug,
  title: d.title,
  post: JSON.parse(d.post),
  issues: JSON.parse(d.issues),
  status: d.status,
  reviewUrl: d.review_url,
  createdAt: d.created_at,
});

export function createApi(deps: Deps = defaultDeps) {
  const app = new Hono<App>().basePath("/api");

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: err.message || "Something went wrong." }, 500);
  });

  // Requests that change something must come from the app itself.
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (
      c.req.method !== "GET" &&
      origin &&
      origin !== new URL(c.env.APP_URL).origin &&
      !c.req.path.endsWith("/billing/webhook")
    )
      throw new HttpError(403, "Cross-site request refused.");
    await next();
  });

  // --- Sign-in -------------------------------------------------------------------------------------------------

  app.post("/auth/start", async (c) => {
    const { email } = await body<{ email?: string }>(c);
    await startLogin(c.env, email ?? "", deps.now(), deps.fetch).catch((e: Error) => {
      throw new HttpError(400, e.message);
    });
    return c.json({ ok: true });
  });

  app.get("/auth/verify", async (c) => {
    try {
      const session = await finishLogin(c.env, c.req.query("token") ?? "", deps.now());
      c.header("set-cookie", sessionCookie(session));
      return c.redirect("/app");
    } catch (e) {
      return c.redirect(`/app/login?error=${encodeURIComponent((e as Error).message)}`);
    }
  });

  app.post("/auth/logout", async (c) => {
    const s = getCookie(c, SESSION_COOKIE);
    if (s) await endSession(c.env, s);
    c.header("set-cookie", sessionCookie("", 0));
    return c.json({ ok: true });
  });

  // Lemon Squeezy calls this without a session; the signature authenticates it.
  app.post("/billing/webhook", async (c) => {
    const raw = await c.req.text();
    const change = await readWebhook(c.env, raw, c.req.header("x-signature") ?? "").catch(() => {
      throw new HttpError(401, "Bad signature.");
    });
    if (change)
      await exec(
        c.env.DB,
        "UPDATE accounts SET plan = ?, plan_status = ?, ls_customer_id = ?, ls_subscription_id = ? WHERE id = ?",
        change.plan,
        change.status,
        change.customerId,
        change.subscriptionId,
        change.accountId,
      );
    return c.json({ ok: true });
  });

  // Google redirects here after sign-in; the signed state carries the site and user.
  app.get("/gsc/callback", async (c) => {
    const parts = await readState(c.env, c.req.query("state") ?? "", deps.now());
    const code = c.req.query("code");
    if (!parts || !code) return c.redirect("/app?gsc=failed");
    const [siteId, userId] = parts as [string, string];
    const owner = await one<{ id: string; url: string }>(
      c.env.DB,
      `SELECT s.id, json_extract(s.profile, '$.url') AS url FROM sites s JOIN users u ON u.account_id = s.account_id
       WHERE s.id = ? AND u.id = ?`,
      siteId,
      userId,
    );
    if (!owner) return c.redirect("/app?gsc=failed");
    const client = { clientId: c.env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: c.env.GOOGLE_OAUTH_CLIENT_SECRET };
    const tokens = await exchangeCode(client, code, `${c.env.APP_URL}/api/gsc/callback`, deps.fetch);
    const props = await listProperties(tokens.accessToken, deps.fetch).catch(() => [] as string[]);
    const host = new URL(owner.url).hostname.replace(/^www\./, "");
    const property = props.find((p) => p === `sc-domain:${host}`) ?? props.find((p) => p.includes(host)) ?? null;
    await exec(
      c.env.DB,
      `INSERT INTO gsc_tokens (site_id, property, refresh_enc) VALUES (?, ?, ?)
       ON CONFLICT (site_id) DO UPDATE SET property = excluded.property, refresh_enc = excluded.refresh_enc`,
      siteId,
      property,
      await encrypt(c.env.RANKKILN_ENCRYPTION_KEY, tokens.refreshToken),
    );
    return c.redirect(`/app/sites/${siteId}?gsc=${property ? "connected" : "pick"}`);
  });

  // --- Everything below needs a session ------------------------------------------------------------------------

  app.use("*", async (c, next) => {
    const user = await sessionUser(c.env, getCookie(c, SESSION_COOKIE), deps.now());
    if (!user) throw new HttpError(401, "Sign in first.");
    c.set("user", user);
    await next();
  });

  app.get("/me", async (c) => {
    const user = c.get("user");
    const account = (await one<AccountRow>(c.env.DB, "SELECT * FROM accounts WHERE id = ?", user.accountId))!;
    const usage = await one<{ posts: number; cost_usd: number }>(
      c.env.DB,
      "SELECT posts, cost_usd FROM usage WHERE account_id = ? AND month = ?",
      user.accountId,
      month(deps.now()),
    );
    const key = await one<{ last4: string }>(
      c.env.DB,
      "SELECT last4 FROM api_keys WHERE account_id = ?",
      user.accountId,
    );
    return c.json({
      email: user.email,
      plan: planFor(account.plan),
      planStatus: account.plan_status,
      plans: Object.values(PLANS).filter((p) => p.id !== "trial"),
      hasSubscription: !!account.ls_subscription_id,
      usage: { month: month(deps.now()), posts: usage?.posts ?? 0, costUsd: usage?.cost_usd ?? 0 },
      apiKey: key ? { last4: key.last4 } : null,
    });
  });

  // --- Sites ---------------------------------------------------------------------------------------------------

  app.post("/sites/propose", async (c) => {
    const { url } = await body<{ url?: string }>(c);
    if (!url || !/^https?:\/\//.test(url)) throw new HttpError(400, "Give the site's full address, with https://.");
    const res = await proposeProfile(deps.llm(c.env.ANTHROPIC_API_KEY, "claude-sonnet-5-5"), url, deps.fetch).catch(
      (e: Error) => {
        throw new HttpError(400, e.message);
      },
    );
    return c.json({ profile: res.profile, pages: res.pages.length });
  });

  app.get("/sites", async (c) => {
    const sites = await all<SiteRow>(
      c.env.DB,
      "SELECT * FROM sites WHERE account_id = ? ORDER BY created_at",
      c.get("user").accountId,
    );
    return c.json(sites.map(siteView));
  });

  app.post("/sites", async (c) => {
    const user = c.get("user");
    const parsed = siteProfileSchema.safeParse((await body<{ profile?: unknown }>(c)).profile);
    if (!parsed.success) throw new HttpError(400, `Profile: ${parsed.error.issues[0]?.message}`);
    const account = (await one<AccountRow>(c.env.DB, "SELECT * FROM accounts WHERE id = ?", user.accountId))!;
    const count = await one<{ n: number }>(
      c.env.DB,
      "SELECT COUNT(*) AS n FROM sites WHERE account_id = ?",
      user.accountId,
    );
    const plan = planFor(account.plan);
    if ((count?.n ?? 0) >= plan.sites)
      throw new HttpError(402, `The ${plan.name} plan includes ${plan.sites} site(s).`);
    const id = newId();
    const now = deps.now();
    await exec(
      c.env.DB,
      "INSERT INTO sites (id, account_id, profile, next_run_at, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      user.accountId,
      JSON.stringify(parsed.data),
      parsed.data.cadence.postsPerWeek ? now + runInterval(parsed.data.cadence.postsPerWeek) : null,
      now,
    );
    return c.json(siteView((await one<SiteRow>(c.env.DB, "SELECT * FROM sites WHERE id = ?", id))!), 201);
  });

  app.get("/sites/:id", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    const conn = await one<ConnectionRow>(c.env.DB, "SELECT * FROM connections WHERE site_id = ?", site.id);
    const gsc = await one<{ property: string | null }>(
      c.env.DB,
      "SELECT property FROM gsc_tokens WHERE site_id = ?",
      site.id,
    );
    return c.json({
      ...siteView(site),
      connection: conn
        ? {
            platform: conn.platform,
            config: JSON.parse(conn.config),
            hasSecret: !!conn.secret_enc,
            verifiedAt: conn.verified_at,
          }
        : null,
      searchConsole: gsc ? { property: gsc.property } : null,
    });
  });

  app.put("/sites/:id", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    const input = await body<{ profile?: unknown; paused?: boolean }>(c);
    const current = parseProfile(site);
    const parsed = siteProfileSchema.safeParse({ ...current, ...(input.profile as object), id: current.id });
    if (!parsed.success) throw new HttpError(400, `Profile: ${parsed.error.issues[0]?.message}`);
    const cadenceChanged = parsed.data.cadence.postsPerWeek !== current.cadence.postsPerWeek;
    const next = !parsed.data.cadence.postsPerWeek
      ? null
      : cadenceChanged || site.next_run_at === null
        ? deps.now() + runInterval(parsed.data.cadence.postsPerWeek)
        : site.next_run_at;
    await exec(
      c.env.DB,
      "UPDATE sites SET profile = ?, paused = ?, next_run_at = ? WHERE id = ?",
      JSON.stringify(parsed.data),
      input.paused === undefined ? site.paused : input.paused ? 1 : 0,
      next,
      site.id,
    );
    return c.json(siteView((await one<SiteRow>(c.env.DB, "SELECT * FROM sites WHERE id = ?", site.id))!));
  });

  app.delete("/sites/:id", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    await exec(c.env.DB, "DELETE FROM sites WHERE id = ?", site.id);
    return c.json({ ok: true });
  });

  // --- Connection to the customer's platform ---------------------------------------------------------------------

  app.put("/sites/:id/connection", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    const input = await body<{ platform?: Platform; config?: Record<string, unknown>; secret?: string }>(c);
    if (!input.platform || !PLATFORMS.includes(input.platform)) throw new HttpError(400, "Pick a platform.");
    const { token, type, ...config } = input.config ?? {};
    const existing = await one<ConnectionRow>(c.env.DB, "SELECT * FROM connections WHERE site_id = ?", site.id);
    const secret = input.secret
      ? await encrypt(c.env.RANKKILN_ENCRYPTION_KEY, input.secret)
      : existing?.platform === input.platform
        ? existing.secret_enc
        : null;
    await exec(
      c.env.DB,
      `INSERT INTO connections (site_id, platform, config, secret_enc, verified_at) VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT (site_id) DO UPDATE SET platform = excluded.platform, config = excluded.config,
         secret_enc = excluded.secret_enc, verified_at = NULL`,
      site.id,
      input.platform,
      JSON.stringify(config),
      secret,
    );
    return c.json({ ok: true });
  });

  app.post("/sites/:id/connection/verify", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    const connector = await siteConnector(c.env, site.id, deps.fetch);
    if (!connector) throw new HttpError(400, "Connect a platform first.");
    const res = await connector.verify();
    if (res.ok) await exec(c.env.DB, "UPDATE connections SET verified_at = ? WHERE site_id = ?", deps.now(), site.id);
    return c.json(res);
  });

  app.delete("/sites/:id/connection", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    await exec(c.env.DB, "DELETE FROM connections WHERE site_id = ?", site.id);
    return c.json({ ok: true });
  });

  // --- Search Console ----------------------------------------------------------------------------------------

  app.get("/sites/:id/gsc/connect", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    const state = await signState(c.env, [site.id, c.get("user").userId], deps.now());
    return c.redirect(
      gscAuthUrl({ clientId: c.env.GOOGLE_OAUTH_CLIENT_ID }, `${c.env.APP_URL}/api/gsc/callback`, state),
    );
  });

  app.put("/sites/:id/gsc", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    const { property } = await body<{ property?: string }>(c);
    if (!property) throw new HttpError(400, "Pick a property.");
    const res = await exec(c.env.DB, "UPDATE gsc_tokens SET property = ? WHERE site_id = ?", property, site.id);
    if (!res.meta.changes) throw new HttpError(400, "Connect Search Console first.");
    return c.json({ ok: true });
  });

  app.delete("/sites/:id/gsc", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    await exec(c.env.DB, "DELETE FROM gsc_tokens WHERE site_id = ?", site.id);
    return c.json({ ok: true });
  });

  // --- Topics --------------------------------------------------------------------------------------------------

  app.get("/sites/:id/topics", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    const rows = await all<TopicRow>(
      c.env.DB,
      "SELECT * FROM topics WHERE site_id = ? ORDER BY status = 'queued' DESC, score DESC LIMIT 200",
      site.id,
    );
    return c.json(rows);
  });

  app.post("/sites/:id/topics/refresh", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    return c.json({ found: await refreshTopics(c.env, site.id, deps) });
  });

  app.post("/sites/:id/topics", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    const query = (await body<{ query?: string }>(c)).query?.trim().toLowerCase();
    if (!query) throw new HttpError(400, "Write the topic.");
    await exec(
      c.env.DB,
      `INSERT INTO topics (id, site_id, query, source, score, reason, action, status, created_at)
       VALUES (?, ?, ?, 'manual', 1000, 'Added by hand', 'new', 'queued', ?)
       ON CONFLICT (site_id, query) DO UPDATE SET status = 'queued', source = 'manual', score = 1000`,
      newId(),
      site.id,
      query,
      deps.now(),
    );
    return c.json({ ok: true }, 201);
  });

  app.patch("/topics/:id", async (c) => {
    const { status } = await body<{ status?: string }>(c);
    if (status !== "queued" && status !== "rejected") throw new HttpError(400, "Status is queued or rejected.");
    const res = await exec(
      c.env.DB,
      "UPDATE topics SET status = ? WHERE id = ? AND site_id IN (SELECT id FROM sites WHERE account_id = ?)",
      status,
      c.req.param("id"),
      c.get("user").accountId,
    );
    if (!res.meta.changes) throw new HttpError(404, "No such topic.");
    return c.json({ ok: true });
  });

  // --- Runs ----------------------------------------------------------------------------------------------------

  app.post("/sites/:id/runs", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    const { topicId } = await body<{ topicId?: string }>(c).catch(() => ({ topicId: undefined }));
    const active = await one<{ n: number }>(
      c.env.DB,
      "SELECT COUNT(*) AS n FROM runs WHERE site_id = ? AND status IN ('queued', 'running')",
      site.id,
    );
    if (active?.n) throw new HttpError(409, "A draft is already being written for this site.");
    const runId = newId();
    await exec(
      c.env.DB,
      "INSERT INTO runs (id, site_id, status, created_at) VALUES (?, ?, 'queued', ?)",
      runId,
      site.id,
      deps.now(),
    );
    await c.env.RUNS.send({ siteId: site.id, runId, ...(topicId ? { topicId } : {}) });
    return c.json({ runId }, 202);
  });

  app.get("/sites/:id/runs", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    return c.json(
      await all(
        c.env.DB,
        `SELECT id, status, topic, error, model, cost_usd AS costUsd, created_at AS createdAt, finished_at AS finishedAt
         FROM runs WHERE site_id = ? ORDER BY created_at DESC LIMIT 50`,
        site.id,
      ),
    );
  });

  // --- Drafts --------------------------------------------------------------------------------------------------

  app.get("/sites/:id/drafts", async (c) => {
    const site = await ownSite(c, c.req.param("id"));
    const rows = await all<DraftRow>(
      c.env.DB,
      "SELECT * FROM drafts WHERE site_id = ? ORDER BY created_at DESC LIMIT 100",
      site.id,
    );
    return c.json(rows.map(draftView));
  });

  app.get("/drafts/:id", async (c) => c.json(draftView(await ownDraft(c, c.req.param("id")))));

  // Edits made in the review screen. Re-checked, but only drafts not yet on the platform can change here.
  app.put("/drafts/:id", async (c) => {
    const draft = await ownDraft(c, c.req.param("id"));
    if (draft.status !== "ready") throw new HttpError(409, "This draft is already on your platform; edit it there.");
    const parsed = postSchema.safeParse((await body<{ post?: unknown }>(c)).post);
    if (!parsed.success) throw new HttpError(400, `Post: ${parsed.error.issues[0]?.message}`);
    const site = (await one<SiteRow>(c.env.DB, "SELECT * FROM sites WHERE id = ?", draft.site_id))!;
    const issues = lint(parsed.data, parseProfile(site));
    await exec(
      c.env.DB,
      "UPDATE drafts SET post = ?, title = ?, slug = ?, issues = ? WHERE id = ?",
      JSON.stringify(parsed.data),
      parsed.data.title,
      parsed.data.slug,
      JSON.stringify(issues),
      draft.id,
    );
    return c.json(draftView((await one<DraftRow>(c.env.DB, "SELECT * FROM drafts WHERE id = ?", draft.id))!));
  });

  // Sends a draft that stayed in Rankkiln (no platform yet, or it failed a check) to the platform as a draft.
  app.post("/drafts/:id/send", async (c) => {
    const draft = await ownDraft(c, c.req.param("id"));
    if (draft.status !== "ready") throw new HttpError(409, "Already sent.");
    const connector = await siteConnector(c.env, draft.site_id, deps.fetch);
    if (!connector) throw new HttpError(400, "Connect a platform first.");
    const ref = await connector.createDraft(postSchema.parse(JSON.parse(draft.post)));
    await exec(
      c.env.DB,
      "UPDATE drafts SET status = 'sent', platform_id = ?, review_url = ? WHERE id = ?",
      ref.id,
      ref.reviewUrl,
      draft.id,
    );
    return c.json({ reviewUrl: ref.reviewUrl });
  });

  app.post("/drafts/:id/approve", async (c) => {
    const draft = await ownDraft(c, c.req.param("id"));
    if (draft.status === "published" || draft.status === "rejected")
      throw new HttpError(409, `Already ${draft.status}.`);
    const connector = await siteConnector(c.env, draft.site_id, deps.fetch);
    if (!connector) throw new HttpError(400, "Connect a platform first.");
    const ref =
      draft.status === "sent" && draft.platform_id
        ? { id: draft.platform_id, reviewUrl: draft.review_url ?? "" }
        : await connector.createDraft(postSchema.parse(JSON.parse(draft.post)));
    await connector.publish(ref);
    await exec(
      c.env.DB,
      "UPDATE drafts SET status = 'published', platform_id = ?, review_url = ? WHERE id = ?",
      ref.id,
      ref.reviewUrl,
      draft.id,
    );
    return c.json({ ok: true });
  });

  app.post("/drafts/:id/reject", async (c) => {
    const draft = await ownDraft(c, c.req.param("id"));
    if (draft.status === "published") throw new HttpError(409, "Already published.");
    await exec(c.env.DB, "UPDATE drafts SET status = 'rejected' WHERE id = ?", draft.id);
    return c.json({ ok: true });
  });

  // --- Own API key and billing -------------------------------------------------------------------------------

  app.put("/api-key", async (c) => {
    const { key } = await body<{ key?: string }>(c);
    if (!key?.startsWith("sk-ant-")) throw new HttpError(400, 'An Anthropic key starts with "sk-ant-".');
    await exec(
      c.env.DB,
      `INSERT INTO api_keys (account_id, key_enc, last4) VALUES (?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET key_enc = excluded.key_enc, last4 = excluded.last4`,
      c.get("user").accountId,
      await encrypt(c.env.RANKKILN_ENCRYPTION_KEY, key),
      key.slice(-4),
    );
    return c.json({ ok: true });
  });

  app.delete("/api-key", async (c) => {
    await exec(c.env.DB, "DELETE FROM api_keys WHERE account_id = ?", c.get("user").accountId);
    return c.json({ ok: true });
  });

  app.post("/billing/checkout", async (c) => {
    const { plan } = await body<{ plan?: string }>(c);
    const user = c.get("user");
    const url = await checkoutUrl(c.env, plan ?? "", user.accountId, user.email, deps.fetch).catch((e: Error) => {
      throw new HttpError(400, e.message);
    });
    return c.json({ url });
  });

  app.get("/billing/portal", async (c) => {
    const account = (await one<AccountRow>(c.env.DB, "SELECT * FROM accounts WHERE id = ?", c.get("user").accountId))!;
    if (!account.ls_subscription_id) throw new HttpError(400, "No subscription yet.");
    return c.json({ url: await portalUrl(c.env, account.ls_subscription_id, deps.fetch) });
  });

  return app;
}
