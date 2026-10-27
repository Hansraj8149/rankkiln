import { describe, expect, it } from "vitest";
import type { Post } from "@rankkiln/core";
import { renderMarkdown, WebhookConnector } from "./index";

const post: Post = {
  slug: "fix-slow-checkout",
  title: "How to fix a slow checkout",
  metaTitle: "Fix a slow checkout",
  description: "Why checkouts get slow.",
  keyword: "slow checkout",
  language: "en",
  tags: ["performance"],
  blocks: [
    { type: "paragraph", text: "Intro with a [link](/audit)." },
    { type: "heading", level: 2, text: "Measure first" },
    { type: "list", ordered: true, items: ["Open DevTools", "Record"] },
  ],
  faq: [{ q: "How long does it take?", a: "Usually a day." }],
  claimsToVerify: [],
};

describe("renderMarkdown", () => {
  it("writes front matter, blocks and the FAQ", () => {
    const md = renderMarkdown(post);
    expect(md).toContain('title: "How to fix a slow checkout"');
    expect(md).toContain("draft: true");
    expect(md).toContain("## Measure first");
    expect(md).toContain("1. Open DevTools\n2. Record");
    expect(md).toContain("### How long does it take?");
  });
});

describe("WebhookConnector", () => {
  it("posts the draft with the bearer token and returns the review link", async () => {
    let seen: { headers: Record<string, string>; body: { event: string; post: Post } } | undefined;
    const fake = (async (_u: string, init: RequestInit) => {
      seen = { headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
      return Response.json({ id: "42", reviewUrl: "https://cms.example.com/posts/42" });
    }) as typeof fetch;
    const ref = await new WebhookConnector({ url: "https://example.com/hook", token: "t0k" }, fake).createDraft(post);
    expect(ref).toEqual({ id: "42", reviewUrl: "https://cms.example.com/posts/42" });
    expect(seen?.headers.authorization).toBe("Bearer t0k");
    expect(seen?.body.event).toBe("draft.created");
    expect(seen?.body.post.slug).toBe("fix-slow-checkout");
  });

  it("explains a failed delivery", async () => {
    const fake = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    await expect(new WebhookConnector({ url: "https://example.com/hook" }, fake).createDraft(post)).rejects.toThrow(
      "HTTP 401",
    );
  });
});
