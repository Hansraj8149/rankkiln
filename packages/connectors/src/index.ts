import type { Post } from "@rankkiln/core";

export interface ExistingPost {
  url: string;
  title: string;
  slug: string;
}

export interface DraftRef {
  /** The platform's id for the draft. */
  id: string;
  /** Where a person reviews it: a CMS edit link, a pull request, or a preview URL. */
  reviewUrl: string;
}

export interface Connector {
  readonly platform: Platform;
  /** Checks the credentials and permissions without changing anything. */
  verify(): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Existing posts, for duplicate checks and internal links. */
  listExisting(): Promise<ExistingPost[]>;
  /** Creates an unpublished draft. */
  createDraft(post: Post): Promise<DraftRef>;
  publish(ref: DraftRef): Promise<void>;
}

import { GhostConnector, type GhostConfig } from "./ghost";
import { GitHubConnector, type GitHubConfig } from "./github";
import { ShopifyConnector, type ShopifyConfig } from "./shopify";
import { WebflowConnector, type WebflowConfig } from "./webflow";
import { WebhookConnector, type WebhookConfig } from "./webhook";
import { WordPressConnector, type WordPressConfig } from "./wordpress";

/** Everything needed to build a connector, secret included. Every platform keeps its secret in `token`. */
export type ConnectorSpec =
  | ({ type: "webhook" } & WebhookConfig)
  | ({ type: "wordpress" } & WordPressConfig)
  | ({ type: "ghost" } & GhostConfig)
  | ({ type: "github" } & GitHubConfig)
  | ({ type: "webflow" } & WebflowConfig)
  | ({ type: "shopify" } & ShopifyConfig);

export type Platform = ConnectorSpec["type"];

export const PLATFORMS: Platform[] = ["webhook", "wordpress", "ghost", "github", "webflow", "shopify"];

export function createConnector(spec: ConnectorSpec, fetchImpl: typeof fetch = fetch): Connector {
  switch (spec.type) {
    case "webhook":
      return new WebhookConnector(spec, fetchImpl);
    case "wordpress":
      return new WordPressConnector(spec, fetchImpl);
    case "ghost":
      return new GhostConnector(spec, fetchImpl);
    case "github":
      return new GitHubConnector(spec, fetchImpl);
    case "webflow":
      return new WebflowConnector(spec, fetchImpl);
    case "shopify":
      return new ShopifyConnector(spec, fetchImpl);
  }
}

export { GhostConnector, ghostToken, type GhostConfig } from "./ghost";
export { GitHubConnector, type GitHubConfig } from "./github";
export { escapeHtml, inlineHtml, renderHtml } from "./html";
export { renderMarkdown } from "./markdown";
export { ShopifyConnector, type ShopifyConfig } from "./shopify";
export { WebflowConnector, type WebflowConfig } from "./webflow";
export { WebhookConnector, type WebhookConfig } from "./webhook";
export { WordPressConnector, type WordPressConfig } from "./wordpress";
