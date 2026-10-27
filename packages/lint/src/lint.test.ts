import { describe, expect, it } from "vitest";
import type { Post } from "@rankkiln/core";
import { lint, words } from "./index";

const base: Post = {
  slug: "fix-slow-checkout",
  title: "How to fix a slow checkout",
  metaTitle: "How to fix a slow checkout",
  description: "Why checkouts get slow and how to fix one.",
  keyword: "slow checkout",
  language: "en",
  tags: [],
  blocks: [{ type: "paragraph", text: "A slow checkout loses sales. Here is how to [find](/audit) the cause." }],
  faq: [],
  claimsToVerify: ["Checkout speed affects conversion"],
};
const site = { titleSuffix: " · Acme", voice: { person: "I" as const, tone: "plain", bannedWords: ["seamless"] } };

describe("lint", () => {
  it("counts words without link markup", () => {
    expect(words(base)).toBe(12);
  });

  it("flags a search title over 60 characters including the suffix", () => {
    const issues = lint({ ...base, metaTitle: "x".repeat(55) }, site);
    expect(issues.map((i) => i.rule)).toContain("meta-title-length");
  });

  it("flags banned words as whole words only", () => {
    const bad = { ...base, blocks: [{ type: "paragraph" as const, text: "A seamless slow checkout." }] };
    expect(lint(bad, site).some((i) => i.rule === "banned-word")).toBe(true);
    const ok = {
      ...base,
      blocks: [{ type: "paragraph" as const, text: "Seamlessly is a different word. slow checkout" }],
    };
    expect(lint(ok, site).some((i) => i.rule === "banned-word")).toBe(false);
  });

  it("flags internal links to pages that don't exist, including absolute ones", () => {
    const post = {
      ...base,
      blocks: [
        { type: "paragraph" as const, text: "See [audit](/audit/) and [old](/gone) and [abs](https://acme.com/nope)." },
      ],
    };
    const issues = lint(post, site, { knownPaths: ["/audit"], siteUrl: "https://acme.com" });
    expect(issues.filter((i) => i.rule === "broken-internal-link").map((i) => i.message)).toEqual([
      "Links to /gone, which isn't a page on the site.",
      "Links to /nope, which isn't a page on the site.",
    ]);
  });

  it("has no errors for a clean post", () => {
    expect(lint(base, site).filter((i) => i.severity === "error")).toEqual([]);
  });
});
