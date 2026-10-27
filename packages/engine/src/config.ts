import type { z } from "zod";
import type { siteProfileSchema } from "@rankkiln/core";

export type SiteProfileInput = z.input<typeof siteProfileSchema>;

export interface WebhookTarget {
  type: "webhook";
  url: string;
  /** Name of the environment variable that holds the bearer token. Keep tokens out of the config file. */
  tokenEnv?: string;
  listUrl?: string;
}

export interface SiteConfig {
  profile: SiteProfileInput;
  /** Where drafts go. Without one, drafts are only written to the output folder. */
  target?: WebhookTarget;
}

export interface RankkilnConfig {
  sites: SiteConfig[];
}

/** Typed helper for rankkiln.config.ts. */
export const defineConfig = (config: RankkilnConfig) => config;
