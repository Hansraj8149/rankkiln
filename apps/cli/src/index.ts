#!/usr/bin/env -S npx tsx
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createConnector, renderMarkdown, type ConnectorSpec } from "@rankkiln/connectors";
import { PRODUCT, siteProfileSchema } from "@rankkiln/core";
import { draftPost, findTopics, proposeProfile, type RankkilnConfig, type SiteConfig } from "@rankkiln/engine";
import { AnthropicProvider, estimateCost, type Effort } from "@rankkiln/llm";
import {
  exchangeCode,
  gscAuthUrl,
  listProperties,
  readSitemap,
  refreshAccessToken,
  searchAnalytics,
  type ExistingPage,
  type GoogleClient,
  type QueryRow,
} from "@rankkiln/topics";

const HELP = `${PRODUCT.name}: researched, SEO-ready blog drafts.

Usage
  pnpm rankkiln init --url <https://your-site>   propose a site profile from the site itself
  pnpm rankkiln sites                           list the sites in the config
  pnpm rankkiln verify --site <id>              check the target's credentials
  pnpm rankkiln topics --site <id>              ranked topic ideas
  pnpm rankkiln draft --site <id> --topic "<topic>" [--keyword "<phrase>"] [--dry-run]
  pnpm rankkiln run --site <id> [--dry-run]     draft the best new topic
  pnpm rankkiln gsc-login                       connect Google Search Console once

Options
  --site      A site id from rankkiln.config.ts
  --topic     What the post is about, in plain words
  --keyword   The search phrase to target (otherwise the brief picks one)
  --dry-run   Write the draft to out/ only; don't send it to the site
  --config    Path to the config file (default: rankkiln.config.ts)

Environment (.env)
  ANTHROPIC_API_KEY   required
  RANKKILN_MODEL      optional, default claude-opus-5-5
  RANKKILN_EFFORT     optional: low | medium | high (default medium; the draft step always uses high)
  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN   for Search Console topics`;

const fail = (msg: string): never => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

async function loadConfig(file: string): Promise<RankkilnConfig> {
  const full = path.resolve(file);
  if (!existsSync(full))
    fail(`No ${file} found. Copy rankkiln.config.example.ts to rankkiln.config.ts and describe your site in it.`);
  const mod = (await import(pathToFileURL(full).href)) as { default?: RankkilnConfig };
  if (!mod.default?.sites?.length) fail(`${file} must export default defineConfig({ sites: [...] }).`);
  return mod.default!;
}

async function existingPages(site: SiteConfig): Promise<ExistingPage[]> {
  const profile = site.profile;
  if (profile.sitemapUrl) return readSitemap(profile.sitemapUrl);
  const connector = connectorFor(site);
  if (!connector || (site.target?.type === "webhook" && !site.target.listUrl)) return [];
  const posts = await connector.listExisting();
  return posts.map((p) => ({ url: p.url, path: new URL(p.url).pathname, title: p.title }));
}

function connectorFor(site: SiteConfig) {
  const t = site.target;
  if (!t) return null;
  const token = t.tokenEnv ? process.env[t.tokenEnv] : undefined;
  if (t.tokenEnv && !token) fail(`Set ${t.tokenEnv} in .env (the ${t.type} secret for ${site.profile.id}).`);
  if (t.type !== "webhook" && !token) fail(`The ${t.type} target for ${site.profile.id} needs tokenEnv.`);
  return createConnector({ ...t, token: token ?? "" } as ConnectorSpec);
}

function findSite(config: RankkilnConfig, id: string | undefined): SiteConfig {
  if (!id) fail("Pass --site <id>. `pnpm rankkiln sites` lists them.");
  const site = config.sites.find((s) => s.profile.id === id);
  if (!site) fail(`No site "${id}" in the config. Known: ${config.sites.map((s) => s.profile.id).join(", ")}`);
  return site!;
}

function provider(effort?: Effort) {
  if (!process.env.ANTHROPIC_API_KEY) fail("Set ANTHROPIC_API_KEY in .env.");
  const model = process.env.RANKKILN_MODEL || undefined;
  return new AnthropicProvider({
    ...(model ? { model } : {}),
    effort: effort ?? ((process.env.RANKKILN_EFFORT || "medium") as Effort),
  });
}

function googleClient(): GoogleClient | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function searchQueries(site: SiteConfig): Promise<QueryRow[]> {
  const client = googleClient();
  const refresh = process.env.GOOGLE_REFRESH_TOKEN;
  if (!site.searchConsole) return [];
  if (!client || !refresh) {
    console.log("  Search Console: skipped (run `pnpm rankkiln gsc-login` and set GOOGLE_* in .env).");
    return [];
  }
  const token = await refreshAccessToken(client, refresh);
  return searchAnalytics(token, site.searchConsole.property);
}

/** Topics already drafted for this site, from the saved drafts. */
function doneTopics(id: string): string[] {
  const dir = path.resolve("out", id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const saved = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as {
        topic?: string;
        brief?: { keyword?: string };
      };
      return [saved.topic, saved.brief?.keyword].filter((x): x is string => !!x);
    });
}

async function rankedTopics(site: SiteConfig) {
  const profile = siteProfileSchema.parse(site.profile);
  const [pages, queries] = await Promise.all([
    existingPages(site).catch(() => [] as ExistingPage[]),
    searchQueries(site).catch((e: Error) => {
      console.log(`  Search Console: ${e.message}`);
      return [] as QueryRow[];
    }),
  ]);
  const topics = await findTopics({ site: profile, pages, queries, done: doneTopics(profile.id) });
  return { topics, queries };
}

async function topicsCmd(config: RankkilnConfig, values: Record<string, string | boolean | undefined>) {
  const site = findSite(config, values.site as string | undefined);
  console.log(`\n${PRODUCT.name} · topics for ${site.profile.name}\n`);
  const { topics, queries } = await rankedTopics(site);
  if (queries.length) console.log(`  ${queries.length} Search Console rows from the last 90 days\n`);
  if (!topics.length)
    return console.log("  No topics found. Add seedKeywords to the profile or connect Search Console.\n");
  for (const t of topics.slice(0, 25))
    console.log(
      `  ${String(t.score).padStart(5)}  ${t.action === "refresh" ? "↻" : "+"} ${t.query}\n         ${t.reason}${t.action === "refresh" && t.page ? `; improve ${t.page} instead` : ""}`,
    );
  console.log("\n  + new post   ↻ an existing page covers it; improve that page instead\n");
}

async function runCmd(config: RankkilnConfig, values: Record<string, string | boolean | undefined>) {
  const site = findSite(config, values.site as string | undefined);
  const { topics } = await rankedTopics(site);
  const pick = topics.find((t) => t.action === "new");
  if (!pick) fail("No new topic to write. Add seedKeywords or manual ideas.");
  console.log(`  Picked: "${pick!.query}" (${pick!.reason})`);
  return draft(config, { ...values, topic: pick!.query, keyword: pick!.query });
}

async function verifyCmd(config: RankkilnConfig, values: Record<string, string | boolean | undefined>) {
  const site = findSite(config, values.site as string | undefined);
  const connector = connectorFor(site);
  if (!connector) return console.log(`\n  ${site.profile.id} has no target; drafts are saved to out/ only.\n`);
  const res = await connector.verify();
  if (!res.ok) fail(`${connector.platform}: ${res.reason}`);
  const posts = await connector.listExisting().catch(() => null);
  console.log(`\n✓ ${connector.platform} connected${posts ? `, ${posts.length} published posts` : ""}.\n`);
}

async function initCmd(values: Record<string, string | boolean | undefined>) {
  const url = values.url as string | undefined;
  if (!url) fail("init needs --url, e.g. --url https://acme.com");
  console.log(`\n${PRODUCT.name} · reading ${url}…`);
  const { profile, pages } = await proposeProfile(provider("low"), url!).catch((e: Error) => fail(e.message));
  console.log(`  ${pages.length} pages in the sitemap\n`);
  console.log("  Paste this into rankkiln.config.ts under sites, then check every fact:\n");
  console.log(JSON.stringify({ profile }, null, 2).replace(/^/gm, "  "));
  console.log("");
}

/** One-time Google sign-in through a loopback redirect; prints the refresh token to keep in .env. */
async function gscLogin() {
  const client = googleClient();
  if (!client) fail("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (a Desktop app OAuth client) in .env.");
  const state = randomUUID();
  const server = createServer();
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
  console.log(
    `\nOpen this link, sign in with the Google account that owns the Search Console property:\n\n${gscAuthUrl(client!, redirect, state)}\n`,
  );
  const code = await new Promise<string>((resolve, reject) =>
    server.on("request", (req, res) => {
      const q = new URL(req.url ?? "/", redirect).searchParams;
      res.end(q.get("code") ? "Connected. You can close this tab." : "Sign-in failed.");
      if (q.get("state") !== state || !q.get("code")) reject(new Error(q.get("error") ?? "Sign-in failed."));
      else resolve(q.get("code")!);
    }),
  ).finally(() => server.close());
  const { accessToken, refreshToken } = await exchangeCode(client!, code, redirect);
  const props = await listProperties(accessToken).catch(() => [] as string[]);
  console.log(`✓ Connected. Add this line to .env:\n\nGOOGLE_REFRESH_TOKEN=${refreshToken}\n`);
  if (props.length)
    console.log(`Properties you can use as searchConsole.property:\n${props.map((p) => `  ${p}`).join("\n")}\n`);
}

async function draft(config: RankkilnConfig, values: Record<string, string | boolean | undefined>) {
  const topic = values.topic as string | undefined;
  if (!topic) fail('draft needs --topic, e.g. --site hs --topic "why AI-built apps break in production"');
  const site = findSite(config, values.site as string | undefined);
  const profile = siteProfileSchema.parse(site.profile);
  const llm = provider();

  console.log(`\n${PRODUCT.name} · ${profile.name} · "${topic}"\n`);
  process.stdout.write("  Reading the site's pages… ");
  const pages = await existingPages(site).catch((e: Error) => {
    console.log(`couldn't (${e.message}); continuing without internal links.`);
    return [] as ExistingPage[];
  });
  if (pages.length) console.log(`${pages.length} pages`);

  const started = Date.now();
  const labels = { brief: "Planning the brief", draft: "Writing the draft", repair: "Fixing failed checks" };
  const out = await draftPost({
    llm,
    site: profile,
    topic: topic!,
    ...(values.keyword ? { keyword: values.keyword as string } : {}),
    pages,
    onStep: (s) => console.log(`  ${labels[s]}…`),
  }).catch((e: Error) => fail(e.message));

  const { post, issues, similar, usage } = out;
  const dir = path.resolve("out", profile.id);
  mkdirSync(dir, { recursive: true });
  const md = path.join(dir, `${post.slug}.md`);
  writeFileSync(md, renderMarkdown(post));
  writeFileSync(path.join(dir, `${post.slug}.json`), JSON.stringify({ topic, ...out }, null, 2));

  const words = post.blocks.reduce(
    (n, b) =>
      n + ("text" in b ? b.text.split(/\s+/).length : b.type === "list" ? b.items.join(" ").split(/\s+/).length : 0),
    0,
  );
  const cost = estimateCost(out.model, usage);
  console.log(`\n✓ ${post.title}`);
  console.log(`  Keyword: ${post.keyword}   Words: ~${words}   Slug: /${post.slug}`);
  console.log(
    `  Search title: ${post.metaTitle}${profile.titleSuffix} (${(post.metaTitle + profile.titleSuffix).length})`,
  );
  console.log(`  Description: ${post.description} (${post.description.length})`);
  if (similar.length) console.log(`  Close to existing: ${similar.map((p) => p.path).join(", ")}`);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  console.log(
    `\n  Checks: ${errors.length} errors, ${warnings.length} warnings${out.repaired ? " (after one repair pass)" : ""}`,
  );
  for (const i of issues) console.log(`   ${i.severity === "error" ? "✗" : "!"} ${i.message}`);

  console.log(`\n  Claims to verify before publishing (${post.claimsToVerify.length}):`);
  for (const c of post.claimsToVerify) console.log(`   - ${c}`);

  console.log(
    `\n  Model: ${out.model}   Tokens: ${usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens} in, ${usage.outputTokens} out` +
      `${cost !== null ? `   Cost: ~$${cost.toFixed(2)}` : ""}   Time: ${Math.round((Date.now() - started) / 1000)}s`,
  );
  console.log(`  Saved: ${path.relative(process.cwd(), md)}`);

  if (values["dry-run"]) return console.log("\n  Dry run: nothing sent to the site.\n");
  const connector = connectorFor(site);
  if (!connector) return console.log("\n  No target set for this site, so the draft is only saved locally.\n");
  if (errors.length) return console.log("\n  Not sent: fix the errors above first (or edit the saved draft).\n");
  const ref = await connector.createDraft(post).catch((e: Error) => fail(e.message));
  console.log(`\n  Sent as an unpublished draft. Review it: ${ref.reviewUrl}\n`);
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      site: { type: "string" },
      topic: { type: "string" },
      keyword: { type: "string" },
      url: { type: "string" },
      config: { type: "string", default: "rankkiln.config.ts" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  const cmd = positionals[0];
  if (!cmd || values.help) return console.log(HELP);

  if (cmd === "init") return initCmd(values);
  if (cmd === "gsc-login") return gscLogin();
  const config = await loadConfig(values.config as string);
  if (cmd === "sites") {
    for (const s of config.sites) console.log(`${s.profile.id.padEnd(14)} ${s.profile.name}  ${s.profile.url}`);
    return;
  }
  if (cmd === "draft") return draft(config, values);
  if (cmd === "topics") return topicsCmd(config, values);
  if (cmd === "run") return runCmd(config, values);
  if (cmd === "verify") return verifyCmd(config, values);
  fail(`Unknown command "${cmd}".\n\n${HELP}`);
}

main();
