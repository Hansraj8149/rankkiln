import type { Post, SiteProfile } from "@rankkiln/core";

export interface LintIssue {
  rule: string;
  message: string;
  severity: "error" | "warning";
}

export const LIMITS = { metaTitle: 60, description: 160, minWords: 900, maxWords: 1800 } as const;

const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`]/g, "");

export function words(post: Post): number {
  let n = 0;
  for (const b of post.blocks) {
    const parts = "text" in b ? [b.text] : b.type === "list" ? b.items : [];
    for (const p of parts) n += plain(p).split(/\s+/).filter(Boolean).length;
  }
  return n;
}

export function lint(post: Post, site: Pick<SiteProfile, "titleSuffix" | "voice">): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (rule: string, message: string) => issues.push({ rule, message, severity: "error" });
  const warn = (rule: string, message: string) => issues.push({ rule, message, severity: "warning" });

  const titleLen = (post.metaTitle + site.titleSuffix).length;
  if (titleLen > LIMITS.metaTitle)
    err("meta-title-length", `Search title is ${titleLen} characters (max ${LIMITS.metaTitle}).`);
  if (post.description.length > LIMITS.description)
    err("description-length", `Description is ${post.description.length} characters (max ${LIMITS.description}).`);

  const kw = post.keyword.toLowerCase();
  if (!post.metaTitle.toLowerCase().includes(kw))
    warn("keyword-in-title", `Search title doesn't contain "${post.keyword}".`);
  const firstPara = post.blocks.find((b) => b.type === "paragraph");
  if (!firstPara || !plain(firstPara.text).toLowerCase().includes(kw))
    warn("keyword-in-intro", `First paragraph doesn't contain "${post.keyword}".`);

  const n = words(post);
  if (n < LIMITS.minWords) warn("too-short", `${n} words (aim for ${LIMITS.minWords}+).`);
  if (n > LIMITS.maxWords) warn("too-long", `${n} words (aim for under ${LIMITS.maxWords}).`);

  const all = JSON.stringify(post.blocks).toLowerCase();
  for (const w of site.voice.bannedWords) {
    if (new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(all))
      err("banned-word", `Uses a banned word: "${w}".`);
  }

  if (post.claimsToVerify.length === 0) warn("claims-list", "No claims to verify were listed; check facts by hand.");
  return issues;
}
