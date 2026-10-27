import { postSchema, type Block, type Post, type SiteProfile } from "@rankkiln/core";
import type { Draft, DraftBlock } from "./schemas";

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 8)
    .join("-");
}

function toBlock(b: DraftBlock): Block | null {
  const text = b.text.trim();
  const items = b.items.map((i) => i.trim()).filter(Boolean);
  switch (b.type) {
    case "heading":
    case "subheading":
      return text ? { type: "heading", level: b.type === "heading" ? 2 : 3, text: text.replace(/^#+\s*/, "") } : null;
    case "paragraph":
      return text ? { type: "paragraph", text } : null;
    case "list":
    case "ordered_list":
      return items.length ? { type: "list", ordered: b.type === "ordered_list", items } : null;
    case "quote":
      return text ? { type: "quote", text } : null;
    case "code":
      return b.code.trim() ? { type: "code", code: b.code, ...(b.lang ? { lang: b.lang } : {}) } : null;
    case "callout":
      return text ? { type: "callout", text } : null;
  }
}

/** Turns the model's draft into a validated Post, adding the site's call to action. */
export function toPost(draft: Draft, keyword: string, site: SiteProfile): Post {
  const blocks = draft.blocks.map(toBlock).filter((b): b is Block => b !== null);
  if (site.cta) blocks.push({ type: "cta", ...site.cta });
  return postSchema.parse({
    slug: slugify(draft.slug || draft.title),
    title: draft.title.trim(),
    metaTitle: draft.metaTitle.trim(),
    description: draft.description.trim(),
    keyword,
    language: site.languages[0],
    tags: draft.tags,
    blocks,
    faq: draft.faq.filter((f) => f.q.trim() && f.a.trim()),
    claimsToVerify: draft.claimsToVerify.filter((c) => c.trim()),
  });
}
