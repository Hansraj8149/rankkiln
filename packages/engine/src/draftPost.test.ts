import { describe, expect, it } from "vitest";
import { FakeProvider } from "@rankkiln/llm";
import { draftPost } from "./draftPost";
import type { Brief, Draft } from "./schemas";

const site = {
  id: "acme",
  name: "Acme",
  url: "https://acme.com",
  titleSuffix: " · Acme",
  audience: "Shop owners",
  voice: { person: "I" as const, tone: "plain", bannedWords: ["seamless"] },
  facts: ["Acme fixes slow online shops."],
  cta: { text: "Want a second pair of eyes?", href: "/contact", label: "Send a brief" },
};
const pages = ["/", "/audit", "/contact", "/journal/core-web-vitals"].map((path) => ({
  url: `https://acme.com${path}`,
  path,
  title: path,
}));

const brief: Brief = {
  keyword: "slow checkout",
  searchIntent: "informational",
  angle: "Measure before you fix",
  title: "How to fix a slow checkout",
  slug: "Fix a Slow Checkout!",
  outline: [{ heading: "Measure first", points: ["DevTools"] }],
  faqQuestions: ["How long?"],
  internalLinks: [{ path: "/audit", anchor: "audit" }],
};
const block = (type: Draft["blocks"][number]["type"], text = "", items: string[] = []) => ({
  type,
  text,
  items,
  code: "",
  lang: "",
});
const draft = (word: string): Draft => ({
  title: "How to fix a slow checkout",
  metaTitle: "How to fix a slow checkout",
  description: "Why checkouts get slow and how to find the cause before you change anything.",
  slug: "fix-slow-checkout",
  tags: ["performance"],
  blocks: [
    block("paragraph", `A slow checkout is a ${word} way to lose sales. Start with an [audit](/audit).`),
    block("heading", "## Measure first"),
    block("ordered_list", "", ["Open DevTools", " "]),
    block("paragraph", "Read [Core Web Vitals](/journal/core-web-vitals) and [ask me](/contact)."),
    block("code", ""),
  ],
  faq: [{ q: "How long?", a: "A day." }],
  claimsToVerify: ["DevTools records network timing"],
});

describe("draftPost", () => {
  it("briefs, drafts, repairs a banned word, and returns a clean post", async () => {
    const llm = new FakeProvider([brief, draft("seamless"), draft("quiet")]);
    const steps: string[] = [];
    const out = await draftPost({ llm, site, topic: "slow checkout", pages, onStep: (s) => steps.push(s) });

    expect(steps).toEqual(["brief", "draft", "repair"]);
    expect(out.repaired).toBe(true);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(out.post.slug).toBe("fix-slow-checkout");
    expect(out.post.blocks[1]).toEqual({ type: "heading", level: 2, text: "Measure first" });
    expect(out.post.blocks[2]).toEqual({ type: "list", ordered: true, items: ["Open DevTools"] });
    expect(out.post.blocks.some((b) => b.type === "code")).toBe(false);
    expect(out.post.blocks.at(-1)).toEqual({ type: "cta", ...site.cta });
    expect(out.post.claimsToVerify).toEqual(["DevTools records network timing"]);
  });

  it("puts the site's pages, facts and banned words in the cached system prompt", async () => {
    const llm = new FakeProvider([brief, draft("quiet")]);
    await draftPost({ llm, site, topic: "slow checkout", pages });
    const [a, b] = llm.requests;
    expect(a!.system).toBe(b!.system);
    expect(a!.system).toContain("- /journal/core-web-vitals");
    expect(a!.system).toContain("Acme fixes slow online shops.");
    expect(a!.system).toContain("seamless");
    expect(a!.system).toContain("at most 53 characters");
  });
});
