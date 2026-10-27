import { z } from "zod";

// Text inside blocks may use [links](/path), **bold** and `code`. Connectors render it for their platform.
const text = z.string().min(1);

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), text }),
  z.object({ type: z.literal("paragraph"), text }),
  z.object({ type: z.literal("list"), ordered: z.boolean().default(false), items: z.array(text).min(1) }),
  z.object({ type: z.literal("quote"), text, cite: z.string().optional() }),
  z.object({ type: z.literal("code"), code: z.string(), lang: z.string().optional() }),
  z.object({ type: z.literal("callout"), text }),
  z.object({ type: z.literal("image"), src: z.string().url(), alt: text, caption: z.string().optional() }),
  z.object({ type: z.literal("cta"), text, href: z.string(), label: text }),
]);
export type Block = z.infer<typeof blockSchema>;

export const faqSchema = z.object({ q: text, a: text });

export const postSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: text,
  /** Title for search results, without the site suffix. */
  metaTitle: text,
  description: text,
  keyword: text,
  language: z.string().default("en"),
  tags: z.array(z.string()).default([]),
  blocks: z.array(blockSchema).min(1),
  faq: z.array(faqSchema).default([]),
  cover: z.object({ src: z.string().url(), alt: text }).optional(),
  /** Statements a person should check before publishing. Never empty-by-default: the model must list them. */
  claimsToVerify: z.array(z.string()).default([]),
});
export type Post = z.infer<typeof postSchema>;
