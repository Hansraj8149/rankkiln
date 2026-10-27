import type { SiteProfile } from "@rankkiln/core";
import { LIMITS } from "@rankkiln/lint";
import type { ExistingPage } from "@rankkiln/topics";
import type { Brief, Draft } from "./schemas";

const PERSON = {
  I: 'Write as one person, in the first person singular ("I"). Never "we", "our team" or "our experts".',
  we: 'Write as the company, in the first person plural ("we").',
  neutral: "Write without a first-person narrator.",
} as const;

/**
 * Everything that stays the same for a site, so it is cached across the brief, draft and repair calls and across
 * runs. Keep it deterministic: no dates, no random order.
 */
export function systemPrompt(site: SiteProfile, pages: ExistingPage[]): string {
  const titleRoom = LIMITS.metaTitle - site.titleSuffix.length;
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- (none given)");
  const pageList = [...pages].sort((a, b) => a.path.localeCompare(b.path)).map((p) => `- ${p.path} — ${p.title}`);

  return `You plan and write blog posts for ${site.name} (${site.url}). The goal is a post that ranks because it is the most useful answer to a real search, not because it repeats keywords.

# Who reads it
${site.audience}

# Voice
${PERSON[site.voice.person]}
Tone: ${site.voice.tone}
Plain words, short sentences, sentence-case headings. No hype.
Never use these words: ${site.voice.bannedWords.join(", ") || "(none)"}.
Language: ${site.languages[0]}.

# Facts you may state about ${site.name}
Only these. Say nothing else about the business, its clients, results, team or prices.
${list(site.facts)}

# Honesty
- Never invent statistics, studies, survey results, customers, testimonials, quotes, prices, dates or results.
- If a point needs a number you can't take from the facts above, make the point without the number.
- List every claim a reader could check (how a tool or platform behaves, limits, laws, third-party prices, anything you are not certain of) in claimsToVerify, one short sentence each. A person checks these before publishing.

# Search
- One primary keyword. Use it naturally in the metaTitle, the first paragraph and at least one heading.
- metaTitle: at most ${titleRoom} characters (the site appends "${site.titleSuffix}"). It can differ from the title.
- description: 120 to 155 characters, says what the reader will get.
- slug: lowercase words joined by hyphens, at most 6 words.
- Answer the search question in the first two paragraphs, then go deeper.
- A heading every 200 to 300 words. Use lists and numbered steps where they help.
- 1,000 to 1,600 words of body text.
- FAQ: 3 to 5 questions people really ask, answered in 2 to 4 sentences each, not repeating the body.

# Links
Link to 3 to 5 of the site's own pages below with [anchor text](/path), using the exact paths listed. Never link to a path that isn't listed. Link elsewhere only to official documentation, with full https URLs.
${pageList.join("\n") || "- (no pages known)"}

# Format
Inside text, use only [links](/path), **bold** and \`code\`. Never put Markdown headings or lists inside text; use heading and list blocks. Don't start the body with the title.${site.cta ? `\nThe site adds this call to action at the end, so don't write your own: "${site.cta.text}"` : ""}`;
}

export function briefPrompt(topic: string, keyword: string | undefined, similar: ExistingPage[]): string {
  return `Plan a post on this topic: ${topic}
${keyword ? `Target keyword: ${keyword}\n` : ""}${
    similar.length
      ? `\nThe site already has pages close to this topic. Pick an angle that doesn't repeat them, and link to them:\n${similar.map((p) => `- ${p.path} — ${p.title}`).join("\n")}\n`
      : ""
  }
Return the brief: the keyword, the search intent, the angle, a working title and slug, an outline of H2 sections (each with the points it must cover), 3 to 5 FAQ questions, and 3 to 5 internal links from the page list with anchor text.`;
}

export function draftPrompt(brief: Brief): string {
  return `Write the full post from this brief.

${JSON.stringify(brief, null, 2)}

Use "heading" blocks for H2 sections and "subheading" for H3. Return the post with its FAQ answers and the claims a person should verify.`;
}

export function repairPrompt(draft: Draft, problems: string[]): string {
  return `This draft failed some checks. Fix only these problems and return the whole post, otherwise unchanged.

Problems:
${problems.map((p) => `- ${p}`).join("\n")}

Draft:
${JSON.stringify(draft, null, 2)}`;
}
