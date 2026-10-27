#!/usr/bin/env -S npx tsx
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { renderMarkdown, WebhookConnector } from "@rankkiln/connectors";
import { PRODUCT, siteProfileSchema } from "@rankkiln/core";
import { draftPost, type RankkilnConfig, type SiteConfig } from "@rankkiln/engine";
import { AnthropicProvider, estimateCost, type Effort } from "@rankkiln/llm";
import { readSitemap, type ExistingPage } from "@rankkiln/topics";

const HELP = `${PRODUCT.name}: researched, SEO-ready blog drafts.

Usage
  pnpm rankkiln draft --site <id> --topic "<topic>" [--keyword "<phrase>"] [--dry-run]
  pnpm rankkiln sites

Options
  --site      A site id from rankkiln.config.ts
  --topic     What the post is about, in plain words
  --keyword   The search phrase to target (otherwise the brief picks one)
  --dry-run   Write the draft to out/ only; don't send it to the site
  --config    Path to the config file (default: rankkiln.config.ts)

Environment (.env)
  ANTHROPIC_API_KEY   required
  RANKKILN_MODEL      optional, default claude-opus-5-5
  RANKKILN_EFFORT     optional: low | medium | high (default medium; the draft step always uses high)`;

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
  if (site.target?.listUrl) {
    const posts = await connectorFor(site)!.listExisting();
    return posts.map((p) => ({ url: p.url, path: new URL(p.url).pathname, title: p.title }));
  }
  return [];
}

function connectorFor(site: SiteConfig) {
  const t = site.target;
  if (!t) return null;
  const token = t.tokenEnv ? process.env[t.tokenEnv] : undefined;
  if (t.tokenEnv && !token) fail(`Set ${t.tokenEnv} in .env (the webhook token for ${site.profile.id}).`);
  return new WebhookConnector({
    url: t.url,
    ...(token ? { token } : {}),
    ...(t.listUrl ? { listUrl: t.listUrl } : {}),
  });
}

async function draft(config: RankkilnConfig, values: Record<string, string | boolean | undefined>) {
  const id = values.site as string | undefined;
  const topic = values.topic as string | undefined;
  if (!id || !topic)
    fail('draft needs --site and --topic, e.g. --site hs --topic "why AI-built apps break in production"');
  const site = config.sites.find((s) => s.profile.id === id);
  if (!site) fail(`No site "${id}" in the config. Known: ${config.sites.map((s) => s.profile.id).join(", ")}`);
  if (!process.env.ANTHROPIC_API_KEY) fail("Set ANTHROPIC_API_KEY in .env.");

  const profile = siteProfileSchema.parse(site!.profile);
  const model = process.env.RANKKILN_MODEL || undefined;
  const effort = (process.env.RANKKILN_EFFORT || "medium") as Effort;
  const llm = new AnthropicProvider({ ...(model ? { model } : {}), effort });

  console.log(`\n${PRODUCT.name} · ${profile.name} · "${topic}"\n`);
  process.stdout.write("  Reading the site's pages… ");
  const pages = await existingPages(site!).catch((e: Error) => {
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
  writeFileSync(path.join(dir, `${post.slug}.json`), JSON.stringify(out, null, 2));

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
  const connector = connectorFor(site!);
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
      config: { type: "string", default: "rankkiln.config.ts" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  const cmd = positionals[0];
  if (!cmd || values.help) return console.log(HELP);

  const config = await loadConfig(values.config as string);
  if (cmd === "sites") {
    for (const s of config.sites) console.log(`${s.profile.id.padEnd(14)} ${s.profile.name}  ${s.profile.url}`);
    return;
  }
  if (cmd === "draft") return draft(config, values);
  fail(`Unknown command "${cmd}".\n\n${HELP}`);
}

main();
