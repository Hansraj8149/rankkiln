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

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Every [text](href) in the post's text. */
export function links(post: Post): string[] {
  const out: string[] = [];
  for (const b of post.blocks) {
    const parts = "text" in b ? [b.text] : b.type === "list" ? b.items : [];
    for (const p of parts) for (const m of p.matchAll(LINK)) out.push(m[2]!);
    if (b.type === "cta") out.push(b.href);
  }
  return out;
}

const normalPath = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export interface LintOptions {
  /** Paths of the site's real pages. When given, internal links are checked against it. */
  knownPaths?: Iterable<string>;
  /** The site's origin, so absolute links to it count as internal. */
  siteUrl?: string;
  minInternalLinks?: number;
}

export function lint(
  post: Post,
  site: Pick<SiteProfile, "titleSuffix" | "voice">,
  opts: LintOptions = {},
): LintIssue[] {
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

  if (opts.knownPaths) {
    const known = new Set([...opts.knownPaths].map(normalPath));
    const origin = opts.siteUrl ? new URL(opts.siteUrl).origin : null;
    let internal = 0;
    for (const href of links(post)) {
      let path: string | null = null;
      if (href.startsWith("/")) path = href;
      else if (origin && href.startsWith(origin)) path = new URL(href).pathname;
      if (path === null) continue;
      internal++;
      const bare = normalPath(path.split(/[?#]/)[0]!);
      if (!known.has(bare)) err("broken-internal-link", `Links to ${path}, which isn't a page on the site.`);
    }
    const min = opts.minInternalLinks ?? 3;
    if (internal < min) warn("few-internal-links", `${internal} internal links (aim for ${min}+).`);
  }

  if (post.claimsToVerify.length === 0) warn("claims-list", "No claims to verify were listed; check facts by hand.");
  return issues;
}
