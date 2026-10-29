import type { Post } from "@rankkiln/core";
import { renderHtml } from "./html";
import { requestJson, trimSlash, verifyBy } from "./http";
import type { Connector, DraftRef, ExistingPost } from "./index";

export interface GhostConfig {
  /** The site's address, e.g. https://blog.example.com */
  url: string;
  /** An Admin API key from Settings → Integrations, shaped "<id>:<secret>". */
  token: string;
}

const b64url = (bytes: Uint8Array | string) => {
  const bin = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
};

/** The short-lived JWT Ghost's Admin API expects, signed with the key's hex secret. */
export async function ghostToken(adminKey: string, now = Date.now()): Promise<string> {
  const [id, secret] = adminKey.split(":");
  if (!id || !secret) throw new Error('A Ghost Admin API key looks like "<id>:<secret>".');
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 300, aud: "/admin/" }));
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(secret.match(/../g)!.map((h) => parseInt(h, 16))),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

interface GhostPost {
  id: string;
  url: string;
  slug: string;
  title: string;
  updated_at: string;
}

/** Ghost through its Admin API. */
export class GhostConnector implements Connector {
  readonly platform = "ghost" as const;

  constructor(
    private config: GhostConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async api<T>(path: string, init: RequestInit = {}) {
    return requestJson<T>(this.fetchImpl, "Ghost", `${trimSlash(this.config.url)}/ghost/api/admin${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "accept-version": "v5.0",
        authorization: `Ghost ${await ghostToken(this.config.token)}`,
      },
    });
  }

  verify() {
    return verifyBy(() => this.api("/posts/?limit=1&fields=id"));
  }

  async listExisting(): Promise<ExistingPost[]> {
    const res = await this.api<{ posts: GhostPost[] }>(
      "/posts/?limit=all&fields=url,slug,title&filter=status:published",
    );
    return res.posts.map((p) => ({ url: p.url, slug: p.slug, title: p.title }));
  }

  async createDraft(post: Post): Promise<DraftRef> {
    const res = await this.api<{ posts: GhostPost[] }>("/posts/?source=html", {
      method: "POST",
      body: JSON.stringify({
        posts: [
          {
            status: "draft",
            title: post.title,
            slug: post.slug,
            html: renderHtml(post),
            custom_excerpt: post.description,
            meta_title: post.metaTitle,
            meta_description: post.description,
            tags: post.tags.map((name) => ({ name })),
          },
        ],
      }),
    });
    const id = res.posts[0]!.id;
    return { id, reviewUrl: `${trimSlash(this.config.url)}/ghost/#/editor/post/${id}` };
  }

  async publish(ref: DraftRef): Promise<void> {
    // Ghost rejects an edit that doesn't carry the post's current updated_at.
    const current = await this.api<{ posts: GhostPost[] }>(`/posts/${ref.id}/?fields=id,updated_at`);
    await this.api(`/posts/${ref.id}/`, {
      method: "PUT",
      body: JSON.stringify({ posts: [{ status: "published", updated_at: current.posts[0]!.updated_at }] }),
    });
  }
}
