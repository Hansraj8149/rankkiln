import type { Post } from "@rankkiln/core";
import { renderHtml } from "./html";
import { requestJson, trimSlash, verifyBy } from "./http";
import type { Connector, DraftRef, ExistingPost } from "./index";

export interface WebflowConfig {
  /** The blog's CMS collection id (Collection settings in the Designer, or the API). */
  collectionId: string;
  /** A site API token with CMS read and write scopes. */
  token: string;
  /** Field slugs in the collection. Webflow names the title "name" and the URL part "slug" itself. */
  fields: { body: string; summary?: string; metaTitle?: string; metaDescription?: string };
  /** Public address of a post is siteUrl + urlPrefix + slug. */
  siteUrl: string;
  urlPrefix?: string;
}

interface WebflowItem {
  id: string;
  fieldData: { name: string; slug: string };
}

/** Webflow CMS (Data API v2). Drafts are collection items with isDraft set. */
export class WebflowConnector implements Connector {
  readonly platform = "webflow" as const;

  constructor(
    private config: WebflowConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private api<T>(path: string, init: RequestInit = {}) {
    return requestJson<T>(
      this.fetchImpl,
      "Webflow",
      `https://api.webflow.com/v2/collections/${this.config.collectionId}${path}`,
      { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${this.config.token}` } },
    );
  }

  verify() {
    return verifyBy(() => this.api(""));
  }

  async listExisting(): Promise<ExistingPost[]> {
    const prefix = this.config.urlPrefix ?? "/blog/";
    const out: ExistingPost[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const res = await this.api<{ items: WebflowItem[] }>(`/items/live?limit=100&offset=${offset}`);
      out.push(
        ...res.items.map((i) => ({
          url: `${trimSlash(this.config.siteUrl)}${prefix}${i.fieldData.slug}`,
          slug: i.fieldData.slug,
          title: i.fieldData.name,
        })),
      );
      if (res.items.length < 100) break;
    }
    return out;
  }

  async createDraft(post: Post): Promise<DraftRef> {
    const f = this.config.fields;
    const item = await this.api<WebflowItem>("/items", {
      method: "POST",
      body: JSON.stringify({
        isArchived: false,
        isDraft: true,
        fieldData: {
          name: post.title,
          slug: post.slug,
          [f.body]: renderHtml(post),
          ...(f.summary ? { [f.summary]: post.description } : {}),
          ...(f.metaTitle ? { [f.metaTitle]: post.metaTitle } : {}),
          ...(f.metaDescription ? { [f.metaDescription]: post.description } : {}),
        },
      }),
    });
    return { id: item.id, reviewUrl: "https://webflow.com/dashboard" };
  }

  async publish(ref: DraftRef): Promise<void> {
    await this.api(`/items/${ref.id}`, { method: "PATCH", body: JSON.stringify({ isDraft: false }) });
    await this.api("/items/publish", { method: "POST", body: JSON.stringify({ itemIds: [ref.id] }) });
  }
}
