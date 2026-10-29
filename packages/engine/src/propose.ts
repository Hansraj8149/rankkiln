import { z } from "zod";
import { siteProfileSchema, type SiteProfile } from "@rankkiln/core";
import type { LlmProvider, Usage } from "@rankkiln/llm";
import { readSitemap, type ExistingPage } from "@rankkiln/topics";

const UA = { "user-agent": "RankkilnBot/0.1 (+https://rankkiln.com)" };

/** The readable parts of an HTML page: title, description, headings and paragraphs, capped in length. */
export function pageText(html: string, max = 6000): string {
  const pick = (re: RegExp) => [...html.matchAll(re)].map((m) => m[1]!);
  const clean = (s: string) =>
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&rsquo;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  const body = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, "");
  const parts = [
    ...pick(/<title[^>]*>([\s\S]*?)<\/title>/gi).map((t) => `Title: ${clean(t)}`),
    ...pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/gi).map((d) => `Description: ${d}`),
    ...[...body.matchAll(/<(h[1-3]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) =>
      m[1]!.startsWith("h") ? `\n## ${clean(m[2]!)}` : clean(m[2]!),
    ),
  ].filter((s) => s.replace(/#/g, "").trim());
  return [...new Set(parts)].join("\n").slice(0, max);
}

const proposalSchema = z.object({
  name: z.string().describe("The business or site name as it presents itself."),
  audience: z.string().describe("Who the site is for, in one or two sentences."),
  person: z.enum(["I", "we", "neutral"]).describe('"I" for a one-person business, "we" for a company.'),
  tone: z.string().describe("How the site sounds, in one sentence."),
  facts: z
    .array(z.string())
    .describe("Plain, checkable facts the site states about itself: what it sells, where, since when. No guesses."),
  seedKeywords: z.array(z.string()).describe("5 to 10 searches the audience types that this site could answer."),
  categories: z.array(z.string()),
  ctaText: z.string().describe("One sentence inviting the reader to the site's main action."),
  ctaHref: z.string().describe("A path from the site's pages for that action, e.g. /contact."),
  ctaLabel: z.string(),
});

export interface ProposeResult {
  profile: SiteProfile;
  pages: ExistingPage[];
  usage: Usage;
}

/**
 * Onboarding: reads the homepage, an about page and the sitemap, and asks the model for a site profile the
 * customer then edits. Only facts the site states about itself are proposed.
 */
export async function proposeProfile(
  llm: LlmProvider,
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProposeResult> {
  const origin = new URL(url).origin;
  const get = async (u: string) => {
    const res = await fetchImpl(u, { headers: UA, redirect: "follow" });
    return res.ok ? res.text() : "";
  };
  const home = await get(origin + "/");
  if (!home) throw new Error(`Couldn't read ${origin}.`);

  const sitemapUrl = `${origin}/sitemap.xml`;
  const pages = await readSitemap(sitemapUrl, fetchImpl).catch(() => [] as ExistingPage[]);
  const aboutPath =
    pages.find((p) => /^\/(about|about-us|story|who-we-are)\/?$/.test(p.path))?.path ??
    [...home.matchAll(/href=["'](\/about[^"'#?]*)["']/gi)][0]?.[1];
  const about = aboutPath ? await get(origin + aboutPath) : "";

  const res = await llm.generate({
    system:
      "You read a website and describe it so a writer can blog for it in its own voice. Use only what the pages say. Never invent facts, prices, numbers or clients.",
    prompt: `Site: ${origin}

Pages it has:
${pages
  .slice(0, 80)
  .map((p) => `- ${p.path}`)
  .join("\n")}

Homepage:
${pageText(home)}
${about ? `\nAbout page (${aboutPath}):\n${pageText(about, 4000)}` : ""}

Describe this site.`,
    schema: proposalSchema,
    effort: "low",
  });
  const p = res.data;
  const profile = siteProfileSchema.parse({
    id: new URL(origin).hostname.replace(/^www\./, "").split(".")[0],
    name: p.name,
    url: origin,
    titleSuffix: ` · ${p.name}`,
    audience: p.audience,
    voice: { person: p.person, tone: p.tone, bannedWords: [] },
    facts: p.facts,
    seedKeywords: p.seedKeywords,
    categories: p.categories,
    cta: { text: p.ctaText, href: p.ctaHref, label: p.ctaLabel },
    ...(pages.length ? { sitemapUrl } : {}),
  });
  return { profile, pages, usage: res.usage };
}
