import { z } from "zod";

// Everything a customer configures about one site. Onboarding proposes it from a crawl; the CLI reads it from
// rankkiln.config.ts.
export const siteProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  /** Appended to search titles, e.g. " · Acme". Counted against the 60-character limit. */
  titleSuffix: z.string().default(""),
  audience: z.string(),
  voice: z.object({
    person: z.enum(["I", "we", "neutral"]),
    tone: z.string(),
    bannedWords: z.array(z.string()).default([]),
  }),
  languages: z.array(z.string()).min(1).default(["en"]),
  /** The only facts a draft may state about the business: products, prices, places, policies. */
  facts: z.array(z.string()).default([]),
  cta: z.object({ text: z.string(), href: z.string(), label: z.string() }).optional(),
  seedKeywords: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  sitemapUrl: z.string().url().optional(),
  cadence: z.object({ postsPerWeek: z.number().int().min(0).max(7) }).default({ postsPerWeek: 1 }),
  /** Off by default: drafts wait for a person. */
  autoPublish: z.boolean().default(false),
});
export type SiteProfile = z.infer<typeof siteProfileSchema>;
