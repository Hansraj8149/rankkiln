import { siteProfileSchema, type Post } from "@rankkiln/core";
import { lint, type LintIssue } from "@rankkiln/lint";
import { addUsage, emptyUsage, type LlmProvider, type Usage } from "@rankkiln/llm";
import { similarPages, type ExistingPage } from "@rankkiln/topics";
import type { SiteProfileInput } from "./config";
import { briefPrompt, draftPrompt, repairPrompt, systemPrompt } from "./prompts";
import { briefSchema, draftSchema, type Brief, type Draft } from "./schemas";
import { toPost } from "./toPost";

export interface DraftInput {
  llm: LlmProvider;
  /** Defaults are filled in from the schema. */
  site: SiteProfileInput;
  topic: string;
  keyword?: string;
  /** The site's existing pages (from its sitemap or connector), for internal links and duplicate checks. */
  pages: ExistingPage[];
  onStep?: (step: "brief" | "draft" | "repair") => void;
}

export interface DraftOutput {
  post: Post;
  brief: Brief;
  issues: LintIssue[];
  /** Existing pages that look like they already cover the topic. */
  similar: ExistingPage[];
  repaired: boolean;
  usage: Usage;
  model: string;
}

export async function draftPost(input: DraftInput): Promise<DraftOutput> {
  const site = siteProfileSchema.parse(input.site);
  const { llm, pages } = input;
  const system = systemPrompt(site, pages);
  const similar = similarPages(input.topic, pages, 0.5).slice(0, 5);
  const check = (post: Post) =>
    lint(post, site, {
      knownPaths: pages.map((p) => p.path),
      siteUrl: site.url,
      minInternalLinks: pages.length ? 3 : 0,
    });

  input.onStep?.("brief");
  const brief = await llm.generate({
    system,
    prompt: briefPrompt(input.topic, input.keyword, similar),
    schema: briefSchema,
  });
  const keyword = input.keyword ?? brief.data.keyword;

  input.onStep?.("draft");
  const first = await llm.generate({ system, prompt: draftPrompt(brief.data), schema: draftSchema, effort: "high" });
  let usage = addUsage(addUsage(emptyUsage(), brief.usage), first.usage);
  let draft: Draft = first.data;
  let post = toPost(draft, keyword, site);
  let issues = check(post);
  let repaired = false;

  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) {
    input.onStep?.("repair");
    const fix = await llm.generate({
      system,
      prompt: repairPrompt(
        draft,
        errors.map((e) => e.message),
      ),
      schema: draftSchema,
    });
    usage = addUsage(usage, fix.usage);
    draft = fix.data;
    post = toPost(draft, keyword, site);
    issues = check(post);
    repaired = true;
  }

  return { post, brief: brief.data, issues, similar, repaired, usage, model: first.model };
}
