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
  readonly platform: "webhook" | "wordpress" | "github" | "ghost" | "webflow" | "shopify";
  /** Checks the credentials and permissions without changing anything. */
  verify(): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Existing posts, for duplicate checks and internal links. */
  listExisting(): Promise<ExistingPost[]>;
  /** Creates an unpublished draft. */
  createDraft(post: Post): Promise<DraftRef>;
  publish(ref: DraftRef): Promise<void>;
}
