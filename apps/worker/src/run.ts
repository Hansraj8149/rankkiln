import type { Connector } from "@rankkiln/connectors";
import { draftPost, findTopics } from "@rankkiln/engine";
import { AnthropicProvider, estimateCost, type LlmProvider } from "@rankkiln/llm";
import { readSitemap, refreshAccessToken, searchAnalytics, type ExistingPage, type QueryRow } from "@rankkiln/topics";
import { decrypt, newId } from "./crypto";
import {
  all,
  exec,
  one,
  parseProfile,
  runInterval,
  siteConnector,
  type AccountRow,
  type SiteRow,
  type TopicRow,
} from "./db";
import { sendMail } from "./email";
import type { Env, RunMessage } from "./env";
import { blockedReason, month, planFor } from "./plans";

export interface Deps {
  /** Builds the model provider for a key. Tests pass a fake. */
  llm: (apiKey: string, model?: string) => LlmProvider;
  fetch: typeof fetch;
  now: () => number;
}

export const defaultDeps: Deps = {
  llm: (apiKey, model) => new AnthropicProvider({ apiKey, ...(model ? { model } : {}) }),
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
};

async function sitePages(profileSitemap: string | undefined, connector: Connector | null, f: typeof fetch) {
  if (profileSitemap) return readSitemap(profileSitemap, f).catch(() => [] as ExistingPage[]);
  if (!connector || connector.platform === "webhook") return [];
  const posts = await connector.listExisting().catch(() => []);
  return posts.map((p) => ({ url: p.url, path: new URL(p.url).pathname, title: p.title }));
}

async function searchRows(env: Env, siteId: string, f: typeof fetch): Promise<QueryRow[]> {
  const row = await one<{ property: string | null; refresh_enc: string }>(
    env.DB,
    "SELECT property, refresh_enc FROM gsc_tokens WHERE site_id = ?",
    siteId,
  );
  if (!row?.property) return [];
  const client = { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET };
  const token = await refreshAccessToken(client, await decrypt(env.RANKKILN_ENCRYPTION_KEY, row.refresh_enc), f);
  return searchAnalytics(token, row.property, {}, f);
}

/** Re-ranks the site's topic queue from every source. Keeps statuses of topics already seen. */
export async function refreshTopics(env: Env, siteId: string, deps: Deps = defaultDeps): Promise<number> {
  const site = await one<SiteRow>(env.DB, "SELECT * FROM sites WHERE id = ?", siteId);
  if (!site) throw new Error("No such site.");
  const profile = parseProfile(site);
  const connector = await siteConnector(env, siteId, deps.fetch);
  const [pages, queries, seen] = await Promise.all([
    sitePages(profile.sitemapUrl, connector, deps.fetch),
    searchRows(env, siteId, deps.fetch).catch(() => [] as QueryRow[]),
    all<{ query: string }>(env.DB, "SELECT query FROM topics WHERE site_id = ? AND status != 'queued'", siteId),
  ]);
  const manual = await all<{ query: string }>(
    env.DB,
    "SELECT query FROM topics WHERE site_id = ? AND source = 'manual' AND status = 'queued'",
    siteId,
  );
  const topics = await findTopics({
    site: profile,
    pages,
    queries,
    manual: manual.map((m) => m.query),
    done: seen.map((s) => s.query),
    fetchImpl: deps.fetch,
  });
  const now = deps.now();
  await env.DB.batch(
    topics.slice(0, 100).map((t) =>
      env.DB.prepare(
        `INSERT INTO topics (id, site_id, query, source, score, reason, action, page, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)
         ON CONFLICT (site_id, query) DO UPDATE SET score = excluded.score, reason = excluded.reason,
           action = excluded.action, page = excluded.page`,
      ).bind(newId(), siteId, t.query, t.source, t.score, t.reason, t.action, t.page ?? null, now),
    ),
  );
  return topics.length;
}

async function notify(env: Env, accountId: string, mail: Omit<Parameters<typeof sendMail>[1], "to">, f: typeof fetch) {
  const users = await all<{ email: string }>(env.DB, "SELECT email FROM users WHERE account_id = ?", accountId);
  for (const u of users) await sendMail(env, { ...mail, to: u.email }, f).catch((e) => console.error(e));
}

/** One queued run: pick a topic, write and check the draft, put it on the platform, record usage, email. */
export async function runSite(env: Env, msg: RunMessage, deps: Deps = defaultDeps): Promise<void> {
  const fail = (error: string) =>
    exec(
      env.DB,
      "UPDATE runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
      error,
      deps.now(),
      msg.runId,
    );

  try {
    await exec(env.DB, "UPDATE runs SET status = 'running' WHERE id = ?", msg.runId);
    const site = await one<SiteRow>(env.DB, "SELECT * FROM sites WHERE id = ?", msg.siteId);
    if (!site) return void (await fail("The site was deleted."));
    const account = (await one<AccountRow>(env.DB, "SELECT * FROM accounts WHERE id = ?", site.account_id))!;
    const profile = parseProfile(site);
    const plan = planFor(account.plan);
    const usage = await one<{ posts: number }>(
      env.DB,
      "SELECT posts FROM usage WHERE account_id = ? AND month = ?",
      account.id,
      month(deps.now()),
    );
    const ownKey = await one<{ key_enc: string }>(
      env.DB,
      "SELECT key_enc FROM api_keys WHERE account_id = ?",
      account.id,
    );
    const blocked = blockedReason(plan, account.plan_status, usage?.posts ?? 0, !!ownKey);
    if (blocked) return void (await fail(blocked));

    const apiKey = ownKey ? await decrypt(env.RANKKILN_ENCRYPTION_KEY, ownKey.key_enc) : env.ANTHROPIC_API_KEY;
    const llm = deps.llm(apiKey, env.RANKKILN_MODEL);
    const connector = await siteConnector(env, site.id, deps.fetch);

    let topic = msg.topicId
      ? await one<TopicRow>(env.DB, "SELECT * FROM topics WHERE id = ? AND site_id = ?", msg.topicId, site.id)
      : null;
    if (!topic) {
      await refreshTopics(env, site.id, deps);
      topic = await one<TopicRow>(
        env.DB,
        "SELECT * FROM topics WHERE site_id = ? AND status = 'queued' AND action = 'new' ORDER BY score DESC LIMIT 1",
        site.id,
      );
    }
    if (!topic) return void (await fail("No new topic to write. Add seed keywords or a topic idea."));
    await exec(env.DB, "UPDATE runs SET topic = ? WHERE id = ?", topic.query, msg.runId);

    const pages = await sitePages(profile.sitemapUrl, connector, deps.fetch);
    const out = await draftPost({ llm, site: profile, topic: topic.query, keyword: topic.query, pages });
    const errors = out.issues.filter((i) => i.severity === "error");

    let status: "ready" | "sent" | "published" = "ready";
    let ref: { id: string; reviewUrl: string } | null = null;
    if (connector && !errors.length) {
      ref = await connector.createDraft(out.post);
      status = "sent";
      if (profile.autoPublish) {
        await connector.publish(ref);
        status = "published";
      }
    }

    const draftId = newId();
    const cost = estimateCost(out.model, out.usage) ?? 0;
    const tokensIn = out.usage.inputTokens + out.usage.cacheReadTokens + out.usage.cacheWriteTokens;
    const now = deps.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO drafts (id, site_id, run_id, slug, title, post, issues, status, platform_id, review_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        draftId,
        site.id,
        msg.runId,
        out.post.slug,
        out.post.title,
        JSON.stringify(out.post),
        JSON.stringify(out.issues),
        status,
        ref?.id ?? null,
        ref?.reviewUrl ?? null,
        now,
      ),
      env.DB.prepare("UPDATE topics SET status = 'drafted' WHERE id = ?").bind(topic.id),
      env.DB.prepare(
        `UPDATE runs SET status = 'done', model = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?, finished_at = ?
         WHERE id = ?`,
      ).bind(out.model, tokensIn, out.usage.outputTokens, cost, now, msg.runId),
      env.DB.prepare(
        `INSERT INTO usage (account_id, month, posts, input_tokens, output_tokens, cost_usd) VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT (account_id, month) DO UPDATE SET posts = posts + 1, input_tokens = input_tokens + excluded.input_tokens,
           output_tokens = output_tokens + excluded.output_tokens, cost_usd = cost_usd + excluded.cost_usd`,
      ).bind(account.id, month(now), tokensIn, out.usage.outputTokens, ownKey ? 0 : cost),
    ]);

    const review = `${env.APP_URL}/app/drafts/${draftId}`;
    await notify(
      env,
      account.id,
      {
        subject:
          status === "published"
            ? `Published: ${out.post.title}`
            : `Draft ready for ${profile.name}: ${out.post.title}`,
        lines: [
          status === "published"
            ? `"${out.post.title}" is live on ${profile.name}.`
            : status === "sent"
              ? `A new draft, "${out.post.title}", is waiting on ${connector!.platform} as unpublished.`
              : errors.length
                ? `A new draft, "${out.post.title}", needs a fix before it can go to your site: ${errors.map((e) => e.message).join(" ")}`
                : `A new draft, "${out.post.title}", is ready to review.`,
          `Keyword: ${out.post.keyword}.`,
        ],
        link: { href: ref?.reviewUrl ?? review, label: "Review the draft" },
        list: { title: "Check these before publishing", items: out.post.claimsToVerify },
      },
      deps.fetch,
    );
  } catch (e) {
    await fail((e as Error).message);
  }
}

/** Cron: queue a run for every site that's due, and move its next run forward so it isn't queued twice. */
export async function enqueueDue(env: Env, now = Date.now()): Promise<number> {
  const due = await all<SiteRow>(
    env.DB,
    "SELECT * FROM sites WHERE paused = 0 AND next_run_at IS NOT NULL AND next_run_at <= ? LIMIT 200",
    now,
  );
  for (const site of due) {
    const { cadence } = parseProfile(site);
    const runId = newId();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO runs (id, site_id, status, created_at) VALUES (?, ?, 'queued', ?)").bind(
        runId,
        site.id,
        now,
      ),
      env.DB.prepare("UPDATE sites SET next_run_at = ? WHERE id = ?").bind(
        cadence.postsPerWeek > 0 ? now + runInterval(cadence.postsPerWeek) : null,
        site.id,
      ),
    ]);
    await env.RUNS.send({ siteId: site.id, runId });
  }
  return due.length;
}
