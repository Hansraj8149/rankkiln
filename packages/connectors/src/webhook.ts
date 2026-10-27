import type { Post } from "@rankkiln/core";
import type { Connector, DraftRef, ExistingPost } from "./index";

export interface WebhookConfig {
  /** Receives POST { event, post } as JSON. */
  url: string;
  /** Sent as "Authorization: Bearer <token>". */
  token?: string;
  /** Optional GET endpoint returning ExistingPost[], for duplicate checks and internal links. */
  listUrl?: string;
}

/**
 * Sends drafts to any HTTP endpoint. The endpoint saves the post unpublished and answers
 * { id, reviewUrl } so the notification can link straight to it.
 */
export class WebhookConnector implements Connector {
  readonly platform = "webhook" as const;

  constructor(
    private config: WebhookConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {}),
    };
  }

  private async send(event: string, body: object): Promise<Response> {
    const res = await this.fetchImpl(this.config.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ event, ...body }),
    });
    if (!res.ok) throw new Error(`Webhook answered HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async verify() {
    try {
      await this.send("ping", {});
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, reason: (e as Error).message };
    }
  }

  async listExisting(): Promise<ExistingPost[]> {
    if (!this.config.listUrl) return [];
    const res = await this.fetchImpl(this.config.listUrl, { headers: this.headers() });
    if (!res.ok) throw new Error(`Couldn't list existing posts (HTTP ${res.status}).`);
    return (await res.json()) as ExistingPost[];
  }

  async createDraft(post: Post): Promise<DraftRef> {
    const res = await this.send("draft.created", { post });
    const ref = (await res.json()) as Partial<DraftRef>;
    if (!ref.id || !ref.reviewUrl) throw new Error("Webhook must answer { id, reviewUrl }.");
    return { id: ref.id, reviewUrl: ref.reviewUrl };
  }

  async publish(ref: DraftRef): Promise<void> {
    await this.send("draft.approved", { id: ref.id });
  }
}
