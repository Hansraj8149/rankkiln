import { z } from "zod";

// What the model returns. Kept flat and free of length constraints so it maps cleanly onto structured output;
// the strict Post schema in @rankkiln/core is applied afterwards.

export const briefSchema = z.object({
  keyword: z.string().describe("The one search phrase this post targets, lowercase, as people type it."),
  searchIntent: z.enum(["informational", "commercial", "transactional", "navigational"]),
  angle: z.string().describe("What this post gives the reader that the top results and the site's own posts don't."),
  title: z.string(),
  slug: z.string(),
  outline: z.array(z.object({ heading: z.string(), points: z.array(z.string()) })),
  faqQuestions: z.array(z.string()),
  internalLinks: z.array(z.object({ path: z.string(), anchor: z.string() })),
});
export type Brief = z.infer<typeof briefSchema>;

export const draftBlockSchema = z.object({
  type: z.enum(["heading", "subheading", "paragraph", "list", "ordered_list", "quote", "code", "callout"]),
  text: z.string().describe("Heading, paragraph, quote or callout text. Empty for lists and code."),
  items: z.array(z.string()).describe("List items. Empty unless the block is a list."),
  code: z.string().describe("Code. Empty unless the block is code."),
  lang: z.string().describe("Code language. Empty unless the block is code."),
});
export type DraftBlock = z.infer<typeof draftBlockSchema>;

export const draftSchema = z.object({
  title: z.string(),
  metaTitle: z.string(),
  description: z.string(),
  slug: z.string(),
  tags: z.array(z.string()),
  blocks: z.array(draftBlockSchema),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  claimsToVerify: z.array(z.string()),
});
export type Draft = z.infer<typeof draftSchema>;
