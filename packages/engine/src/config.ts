import type { z } from "zod";
import type { ConnectorSpec } from "@rankkiln/connectors";
import type { siteProfileSchema } from "@rankkiln/core";

export type SiteProfileInput = z.input<typeof siteProfileSchema>;

type WithoutToken<T> = T extends unknown ? Omit<T, "token"> : never;

/**
 * Where drafts go: any connector's settings, minus the secret. `tokenEnv` names the environment variable that holds
 * it (a webhook token, WordPress application password, Ghost Admin key or API token). Keep secrets out of the
 * config file.
 */
export type Target = WithoutToken<ConnectorSpec> & { tokenEnv?: string };

/** @deprecated Use Target with type "webhook". */
export type WebhookTarget = Extract<Target, { type: "webhook" }>;

export interface SiteConfig {
  profile: SiteProfileInput;
  /** Where drafts go. Without one, drafts are only written to the output folder. */
  target?: Target;
  /** Search Console property, e.g. "sc-domain:acme.com" or "https://acme.com/". Needs GOOGLE_* in .env. */
  searchConsole?: { property: string };
}

export interface RankkilnConfig {
  sites: SiteConfig[];
}

/** Typed helper for rankkiln.config.ts. */
export const defineConfig = (config: RankkilnConfig) => config;
