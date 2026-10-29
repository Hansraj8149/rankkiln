import type { Post } from "@rankkiln/core";
import { renderHtml } from "./html";
import { base64, requestJson, trimSlash, verifyBy } from "./http";
import type { Connector, DraftRef, ExistingPost } from "./index";

export interface WordPressConfig {
  /** The site's address, e.g. https://blog.example.com */
  url: string;
  username: string;
  /** An application password (Users → Profile → Application passwords), not the login password. */
  token: string;
}

interface WpPost {
  id: number;
  link: string;
  slug: string;
  title: { rendered: string };
}

/** WordPress through its REST API. Drafts are created with status "draft". */
export class WordPressConnector implements Connector {
  readonly platform = "wordpress" as const;

  constructor(
    private config: WordPressConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private api<T>(path: string, init: RequestInit = {}) {
    return requestJson<T>(this.fetchImpl, "WordPress", `${trimSlash(this.config.url)}/wp-json/wp/v2${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${base64(`${this.config.username}:${this.config.token}`)}`,
      },
    });
  }

  verify() {
    return verifyBy(() => this.api("/users/me?context=edit"));
  }

  async listExisting(): Promise<ExistingPost[]> {
    const out: ExistingPost[] = [];
    for (let page = 1; page <= 10; page++) {
      const posts = await this.api<WpPost[]>(`/posts?per_page=100&page=${page}&_fields=id,link,slug,title`).catch(
        (e: Error) => {
          // WordPress answers 400 when asked for a page past the last one.
          if (page > 1 && e.message.includes("HTTP 400")) return [];
          throw e;
        },
      );
      out.push(...posts.map((p) => ({ url: p.link, slug: p.slug, title: p.title.rendered })));
      if (posts.length < 100) break;
    }
    return out;
  }

  async createDraft(post: Post): Promise<DraftRef> {
    const created = await this.api<WpPost>("/posts", {
      method: "POST",
      body: JSON.stringify({
        status: "draft",
        title: post.title,
        slug: post.slug,
        excerpt: post.description,
        content: renderHtml(post),
      }),
    });
    return {
      id: String(created.id),
      reviewUrl: `${trimSlash(this.config.url)}/wp-admin/post.php?post=${created.id}&action=edit`,
    };
  }

  async publish(ref: DraftRef): Promise<void> {
    await this.api(`/posts/${ref.id}`, { method: "POST", body: JSON.stringify({ status: "publish" }) });
  }
}
