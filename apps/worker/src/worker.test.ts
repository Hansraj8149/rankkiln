import { describe, expect, it } from "vitest";
import { FakeProvider } from "@rankkiln/llm";
import { createApi } from "./api";
import { decrypt, encrypt, hmacHex } from "./crypto";
import { exec, one } from "./db";
import type { Deps } from "./run";
import { enqueueDue, runSite } from "./run";
import { testEnv } from "./testing";

// Responses in these tests are read loosely; the assertions check their shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Promise<Response>): Promise<any> => (await res).json();

const NOW = Date.UTC(2026, 9, 28, 12);

const profile = {
  id: "acme",
  name: "Acme",
  url: "https://acme.com",
  titleSuffix: " · Acme",
  audience: "Shop owners",
  voice: { person: "I", tone: "plain", bannedWords: [] },
  facts: ["Acme fixes slow online shops."],
  seedKeywords: [],
  cadence: { postsPerWeek: 2 },
};

const brief = {
  keyword: "slow checkout",
  searchIntent: "informational",
  angle: "Measure first",
  title: "How to fix a slow checkout",
  slug: "fix-slow-checkout",
  outline: [{ heading: "Measure", points: ["DevTools"] }],
  faqQuestions: [],
  internalLinks: [],
};
const draft = {
  title: "How to fix a slow checkout",
  metaTitle: "How to fix a slow checkout",
  description: "Why checkouts get slow and how to find the cause before you change anything.",
  slug: "fix-slow-checkout",
  tags: [],
  blocks: [{ type: "paragraph", text: "A slow checkout loses sales.", items: [], code: "", lang: "" }],
  faq: [],
  claimsToVerify: ["DevTools records network timing"],
};

interface Sent {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/** A fetch for Resend, the customer's webhook and autocomplete; records what was sent. */
function fakeFetch() {
  const sent: Sent[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    sent.push({ url, body, headers: (init.headers ?? {}) as Record<string, string> });
    if (url.startsWith("https://api.resend.com")) return Response.json({ id: "email" });
    if (url.startsWith("https://hooks.acme.com"))
      return Response.json({ id: "p1", reviewUrl: "https://cms.acme.com/p1" });
    if (url.startsWith("https://suggestqueries")) return Response.json(["", []]);
    if (url.startsWith("https://api.lemonsqueezy.com")) return Response.json({ data: {} });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { impl, sent };
}

function setup() {
  const env = testEnv();
  const net = fakeFetch();
  const llm = new FakeProvider([brief, draft]);
  const deps: Deps = { llm: () => llm, fetch: net.impl, now: () => NOW };
  const app = createApi(deps);
  let cookie = "";
  const call = async (method: string, path: string, json?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.fetch(
      new Request(`https://rankkiln.test/api${path}`, {
        method,
        headers: { "content-type": "application/json", cookie, ...headers },
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
        redirect: "manual",
      }),
      env,
    );
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    return res;
  };
  const signIn = async (email = "owner@acme.com") => {
    cookie = "";
    await call("POST", "/auth/start", { email });
    const mail = net.sent.filter((s) => s.url.startsWith("https://api.resend.com")).at(-1)!;
    const link = (mail.body as { text: string }).text.match(
      /https:\/\/rankkiln\.test(\/api\/auth\/verify\?token=\S+)/,
    )![1]!;
    const res = await call("GET", link.replace("/api", ""));
    expect(res.status).toBe(302);
    return res;
  };
  return { env, net, llm, deps, call, signIn };
}

describe("crypto", () => {
  it("round-trips a secret and never stores it in plain text", async () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
    const sealed = await encrypt(key, "app-password");
    expect(sealed).not.toContain("app-password");
    expect(await decrypt(key, sealed)).toBe("app-password");
  });
});

describe("sign-in", () => {
  it("signs in with a magic link once, and the link can't be reused", async () => {
    const t = setup();
    await t.signIn();
    expect((await json(t.call("GET", "/me"))).email).toBe("owner@acme.com");

    const mail = t.net.sent.find((s) => s.url.startsWith("https://api.resend.com"))!;
    const link = (mail.body as { text: string }).text.match(/\/api(\/auth\/verify\?token=\S+)/)![1]!;
    const again = await t.call("GET", link);
    expect(again.headers.get("location")).toContain("already%20used");
  });

  it("refuses API calls without a session and cross-site writes", async () => {
    const t = setup();
    expect((await t.call("GET", "/sites")).status).toBe(401);
    await t.signIn();
    const res = await t.call("POST", "/sites", { profile }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("sites, connections and runs", () => {
  it("creates a site, stores the platform secret encrypted, runs a draft and emails the owner", async () => {
    const t = setup();
    await t.signIn();
    const site = await json(t.call("POST", "/sites", { profile }));
    expect(site.nextRunAt).toBe(NOW + 3.5 * 86_400_000);

    await t.call("PUT", `/sites/${site.id}/connection`, {
      platform: "webhook",
      config: { url: "https://hooks.acme.com/ingest" },
      secret: "hook-secret",
    });
    const row = await one<{ secret_enc: string }>(t.env.DB, "SELECT secret_enc FROM connections");
    expect(row!.secret_enc).not.toContain("hook-secret");
    const detail = await json(t.call("GET", `/sites/${site.id}`));
    expect(detail.connection).toMatchObject({ platform: "webhook", hasSecret: true });
    expect(JSON.stringify(detail)).not.toContain("hook-secret");

    await t.call("POST", `/sites/${site.id}/topics`, { query: "Slow checkout" });
    const run = await t.call("POST", `/sites/${site.id}/runs`, {});
    expect(run.status).toBe(202);
    expect((await t.call("POST", `/sites/${site.id}/runs`, {})).status).toBe(409);

    await runSite(t.env, t.env.sent[0]!, t.deps);

    const hook = t.net.sent.find((s) => s.url.startsWith("https://hooks.acme.com"))!;
    expect(hook.headers.authorization).toBe("Bearer hook-secret");
    const drafts = await json(t.call("GET", `/sites/${site.id}/drafts`));
    expect(drafts[0]).toMatchObject({
      status: "sent",
      reviewUrl: "https://cms.acme.com/p1",
      slug: "fix-slow-checkout",
    });
    const runs = await json(t.call("GET", `/sites/${site.id}/runs`));
    expect(runs[0]).toMatchObject({ status: "done", topic: "slow checkout" });
    expect((await json(t.call("GET", "/me"))).usage.posts).toBe(1);

    const mail = t.net.sent.filter((s) => s.url.startsWith("https://api.resend.com")).at(-1)!;
    expect(mail.body).toMatchObject({ to: "owner@acme.com", subject: expect.stringContaining("Draft ready") });
    expect((mail.body as { text: string }).text).toContain("DevTools records network timing");
  });

  it("stops at the plan's monthly limit", async () => {
    const t = setup();
    await t.signIn();
    const site = await json(t.call("POST", "/sites", { profile }));
    const account = (await one<{ account_id: string }>(t.env.DB, "SELECT account_id FROM users"))!.account_id;
    await t.env.DB.prepare("INSERT INTO usage (account_id, month, posts) VALUES (?, '2026-10', 2)").bind(account).run();
    await t.call("POST", `/sites/${site.id}/runs`, {});
    await runSite(t.env, t.env.sent[0]!, t.deps);
    const runs = await json(t.call("GET", `/sites/${site.id}/runs`));
    expect(runs[0]).toMatchObject({ status: "failed", error: expect.stringContaining("2 posts are used") });
    expect(t.llm.requests).toHaveLength(0);
  });

  it("keeps one account out of another's sites", async () => {
    const t = setup();
    await t.signIn("a@a.com");
    const site = await json(t.call("POST", "/sites", { profile }));
    await t.signIn("b@b.com");
    expect((await t.call("GET", `/sites/${site.id}`)).status).toBe(404);
    expect(await json(t.call("GET", "/sites"))).toEqual([]);
  });

  it("cron queues due sites once", async () => {
    const t = setup();
    await t.signIn();
    await t.call("POST", "/sites", { profile });
    expect(await enqueueDue(t.env, NOW)).toBe(0);
    expect(await enqueueDue(t.env, NOW + 4 * 86_400_000)).toBe(1);
    expect(await enqueueDue(t.env, NOW + 4 * 86_400_000)).toBe(0);
    expect(t.env.sent).toHaveLength(1);
  });
});

describe("billing webhook", () => {
  it("sets the plan from a signed subscription event and rejects a bad signature", async () => {
    const t = setup();
    await t.signIn();
    const account = (await one<{ account_id: string }>(t.env.DB, "SELECT account_id FROM users"))!.account_id;
    const raw = JSON.stringify({
      meta: { event_name: "subscription_created", custom_data: { account_id: account } },
      data: { id: "sub_1", type: "subscriptions", attributes: { status: "active", variant_id: 22, customer_id: 9 } },
    });
    expect((await t.call("POST", "/billing/webhook", JSON.parse(raw), { "x-signature": "nope" })).status).toBe(401);
    const ok = await t.call("POST", "/billing/webhook", JSON.parse(raw), {
      "x-signature": await hmacHex("whsec", raw),
    });
    expect(ok.status).toBe(200);
    expect((await json(t.call("GET", "/me"))).plan.id).toBe("growth");
  });
});

describe("account deletion", () => {
  it("cancels the subscription, then deletes the account and everything in it", async () => {
    const t = setup();
    await t.signIn();
    const site = await json(t.call("POST", "/sites", { profile }));
    await t.call("PUT", "/api-key", { key: "sk-ant-own-1234" });
    await exec(t.env.DB, "UPDATE accounts SET ls_subscription_id = 'sub_1'");

    expect((await t.call("DELETE", "/account", { email: "someone@else.com" })).status).toBe(400);
    expect((await t.call("DELETE", "/account", { email: "Owner@acme.com" })).status).toBe(200);

    const cancel = t.net.sent.find((s) => s.url === "https://api.lemonsqueezy.com/v1/subscriptions/sub_1")!;
    expect(cancel).toBeDefined();
    for (const table of ["accounts", "users", "sessions", "sites", "api_keys", "login_tokens"])
      expect(await one(t.env.DB, `SELECT 1 FROM ${table}`)).toBeNull();
    expect(await one(t.env.DB, "SELECT 1 FROM sites WHERE id = ?", site.id)).toBeNull();
    expect((await t.call("GET", "/me")).status).toBe(401);
  });
});
