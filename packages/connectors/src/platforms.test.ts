import { describe, expect, it } from "vitest";
import type { Post } from "@rankkiln/core";
import { createConnector, ghostToken, renderHtml } from "./index";

const post: Post = {
  slug: "fix-slow-checkout",
  title: "How to fix a slow checkout",
  metaTitle: "Fix a slow checkout",
  description: "Why checkouts get slow.",
  keyword: "slow checkout",
  language: "en",
  tags: ["performance"],
  blocks: [
    { type: "paragraph", text: "Read the **audit** <first> at [audit](/audit) or [bad](javascript:alert(1))." },
    { type: "list", ordered: false, items: ["`npm run build`"] },
    { type: "cta", text: "Need help?", href: "/contact", label: "Send a brief" },
  ],
  faq: [{ q: "How long?", a: "A day." }],
  claimsToVerify: ["DevTools records network timing"],
};

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that answers by "METHOD url-prefix" and records every call. */
function fakeApi(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({
      method,
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const key = Object.keys(routes).find((k) => `${method} ${url}`.startsWith(k));
    if (!key) return new Response(`no route for ${method} ${url}`, { status: 404 });
    return Response.json(routes[key]);
  }) as typeof fetch;
  return { impl, calls };
}

describe("renderHtml", () => {
  it("escapes text, keeps safe links, drops unsafe ones and adds the FAQ", () => {
    const html = renderHtml(post);
    expect(html).toContain("<strong>audit</strong> &lt;first&gt;");
    expect(html).toContain('<a href="/audit">audit</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<li><code>npm run build</code></li>");
    expect(html).toContain("<h3>How long?</h3><p>A day.</p>");
  });
});

describe("WordPress", () => {
  it("creates a draft with basic auth and links to the editor", async () => {
    const { impl, calls } = fakeApi({ "POST https://wp.example.com/wp-json/wp/v2/posts": { id: 7 } });
    const wp = createConnector(
      { type: "wordpress", url: "https://wp.example.com/", username: "me", token: "ab cd" },
      impl,
    );
    const ref = await wp.createDraft(post);
    expect(ref).toEqual({ id: "7", reviewUrl: "https://wp.example.com/wp-admin/post.php?post=7&action=edit" });
    expect(calls[0]!.headers.authorization).toBe(`Basic ${btoa("me:ab cd")}`);
    expect(calls[0]!.body).toMatchObject({ status: "draft", slug: "fix-slow-checkout", excerpt: post.description });
  });

  it("lists published posts", async () => {
    const { impl } = fakeApi({
      "GET https://wp.example.com/wp-json/wp/v2/posts?per_page=100&page=1": [
        { id: 1, link: "https://wp.example.com/hello", slug: "hello", title: { rendered: "Hello" } },
      ],
    });
    const wp = createConnector({ type: "wordpress", url: "https://wp.example.com", username: "me", token: "x" }, impl);
    expect(await wp.listExisting()).toEqual([{ url: "https://wp.example.com/hello", slug: "hello", title: "Hello" }]);
  });
});

describe("Ghost", () => {
  const key = "abc123:" + "00".repeat(32);

  it("signs a JWT with the key id", async () => {
    const [head, body, sig] = (await ghostToken(key, 1_700_000_000_000)).split(".");
    expect(JSON.parse(atob(head!))).toEqual({ alg: "HS256", typ: "JWT", kid: "abc123" });
    expect(JSON.parse(atob(body!))).toEqual({ iat: 1_700_000_000, exp: 1_700_000_300, aud: "/admin/" });
    expect(sig).toMatch(/^[\w-]{43}$/);
  });

  it("creates an HTML draft and publishes with updated_at", async () => {
    const { impl, calls } = fakeApi({
      "POST https://g.example.com/ghost/api/admin/posts/?source=html": { posts: [{ id: "p1" }] },
      "GET https://g.example.com/ghost/api/admin/posts/p1/": {
        posts: [{ id: "p1", updated_at: "2026-10-28T00:00:00Z" }],
      },
      "PUT https://g.example.com/ghost/api/admin/posts/p1/": { posts: [{ id: "p1" }] },
    });
    const ghost = createConnector({ type: "ghost", url: "https://g.example.com", token: key }, impl);
    const ref = await ghost.createDraft(post);
    expect(ref.reviewUrl).toBe("https://g.example.com/ghost/#/editor/post/p1");
    expect(calls[0]!.headers.authorization).toMatch(/^Ghost ey/);
    expect(calls[0]!.body).toMatchObject({ posts: [{ status: "draft", meta_title: "Fix a slow checkout" }] });
    await ghost.publish(ref);
    expect(calls.at(-1)!.body).toEqual({ posts: [{ status: "published", updated_at: "2026-10-28T00:00:00Z" }] });
  });
});

describe("GitHub", () => {
  const spec = {
    type: "github" as const,
    repo: "acme/site",
    token: "ghp",
    dir: "content/blog/",
    siteUrl: "https://acme.com",
  };
  const r = "https://api.github.com/repos/acme/site";

  it("opens a draft pull request that adds the post", async () => {
    const { impl, calls } = fakeApi({
      [`GET ${r}/git/ref/heads/main`]: { object: { sha: "s1" } },
      [`GET ${r}`]: { default_branch: "main" },
      [`POST ${r}/git/refs`]: {},
      [`PUT ${r}/contents/content/blog/fix-slow-checkout.md`]: {},
      [`POST ${r}/pulls`]: { number: 12, html_url: "https://github.com/acme/site/pull/12" },
    });
    const ref = await createConnector(spec, impl).createDraft(post);
    expect(ref).toEqual({ id: "12", reviewUrl: "https://github.com/acme/site/pull/12" });
    expect(calls[2]!.body).toEqual({ ref: "refs/heads/rankkiln/fix-slow-checkout", sha: "s1" });
    const put = calls[3]!.body as { content: string; branch: string };
    expect(put.branch).toBe("rankkiln/fix-slow-checkout");
    expect(atob(put.content)).toContain("draft: true");
    expect((calls[4]!.body as { body: string }).body).toContain("- [ ] DevTools records network timing");
  });

  it("flips draft, marks the pull request ready and merges", async () => {
    const md = btoa("---\ntitle: x\ndraft: true\n---\n");
    const { impl, calls } = fakeApi({
      [`GET ${r}/pulls/12/files`]: [{ filename: "content/blog/x.md" }],
      [`GET ${r}/pulls/12`]: { node_id: "PR_1", draft: true, head: { ref: "rankkiln/x" } },
      [`GET ${r}/contents/content/blog/x.md?ref=rankkiln%2Fx`]: { sha: "f1", content: md },
      [`PUT ${r}/contents/content/blog/x.md`]: {},
      "POST https://api.github.com/graphql": { data: {} },
      [`PUT ${r}/pulls/12/merge`]: { merged: true },
    });
    await createConnector(spec, impl).publish({ id: "12", reviewUrl: "" });
    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/contents/"))!.body as { content: string };
    expect(atob(put.content)).toContain("draft: false");
    expect(calls.map((c) => c.url).slice(-2)).toEqual(["https://api.github.com/graphql", `${r}/pulls/12/merge`]);
  });
});

describe("Webflow", () => {
  it("creates a draft item with mapped fields", async () => {
    const { impl, calls } = fakeApi({ "POST https://api.webflow.com/v2/collections/c1/items": { id: "i1" } });
    const wf = createConnector(
      {
        type: "webflow",
        collectionId: "c1",
        token: "t",
        fields: { body: "post-body", summary: "summary" },
        siteUrl: "https://acme.com",
      },
      impl,
    );
    expect((await wf.createDraft(post)).id).toBe("i1");
    expect(calls[0]!.body).toMatchObject({
      isDraft: true,
      fieldData: { name: post.title, slug: post.slug, summary: post.description },
    });
    expect((calls[0]!.body as { fieldData: Record<string, string> }).fieldData["post-body"]).toContain("<p>");
  });
});

describe("Shopify", () => {
  it("creates an unpublished article with SEO metafields", async () => {
    const { impl, calls } = fakeApi({
      "POST https://acme.myshopify.com/admin/api/": {
        data: { articleCreate: { article: { id: "gid://shopify/Article/99" }, userErrors: [] } },
      },
    });
    const shop = createConnector({ type: "shopify", shop: "acme", token: "shpat", blogId: "5", author: "Acme" }, impl);
    const ref = await shop.createDraft(post);
    expect(ref.reviewUrl).toBe("https://admin.shopify.com/store/acme/content/articles/99");
    expect(calls[0]!.headers["x-shopify-access-token"]).toBe("shpat");
    const vars = (calls[0]!.body as { variables: { article: Record<string, unknown> } }).variables.article;
    expect(vars).toMatchObject({ blogId: "gid://shopify/Blog/5", handle: post.slug, isPublished: false });
  });

  it("surfaces user errors", async () => {
    const { impl } = fakeApi({
      "POST https://acme.myshopify.com/admin/api/": {
        data: { articleCreate: { article: null, userErrors: [{ field: ["handle"], message: "Handle is taken" }] } },
      },
    });
    const shop = createConnector({ type: "shopify", shop: "acme", token: "t", blogId: "5", author: "A" }, impl);
    await expect(shop.createDraft(post)).rejects.toThrow("Handle is taken");
  });
});
