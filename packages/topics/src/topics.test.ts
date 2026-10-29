import { describe, expect, it } from "vitest";
import { expandSeeds, rankTopics, readSitemap, similarPages, titleFromUrl } from "./index";

describe("sitemap", () => {
  it("follows a sitemap index and derives titles", async () => {
    const files: Record<string, string> = {
      "https://x.com/sitemap.xml": "<sitemapindex><sitemap><loc>https://x.com/a.xml</loc></sitemap></sitemapindex>",
      "https://x.com/a.xml": "<urlset><url><loc>https://x.com/journal/fix-slow-checkout</loc></url></urlset>",
    };
    const fake = (async (u: string) => new Response(files[u] ?? "", { status: files[u] ? 200 : 404 })) as typeof fetch;
    const pages = await readSitemap("https://x.com/sitemap.xml", fake);
    expect(pages).toEqual([
      {
        url: "https://x.com/journal/fix-slow-checkout",
        path: "/journal/fix-slow-checkout",
        title: "Fix slow checkout",
      },
    ]);
  });

  it("titles the root page Home", () => {
    expect(titleFromUrl("https://x.com/")).toBe("Home");
  });
});

describe("similarPages", () => {
  const pages = [
    { title: "Lovable Supabase security checklist", path: "/journal/lovable-supabase-security-checklist" },
    { title: "Whatsapp is the checkout", path: "/journal/whatsapp-is-the-checkout" },
  ];
  it("finds a page covering the same topic", () => {
    expect(similarPages("Supabase security checklist for Lovable apps", pages)[0]?.path).toBe(
      "/journal/lovable-supabase-security-checklist",
    );
  });
  it("ignores unrelated pages", () => {
    expect(similarPages("Hiring a React Native developer", pages)).toEqual([]);
  });
});

describe("rankTopics", () => {
  const row = (query: string, impressions: number, position: number, page = "https://x.com/") => ({
    query,
    page,
    clicks: 0,
    impressions,
    position,
  });

  it("puts near-miss Search Console queries first and skips branded, top-ranking and buried ones", () => {
    const topics = rankTopics(
      {
        queries: [
          row("hansraj saini", 900, 1.2),
          row("lovable app security audit", 300, 9),
          row("supabase rls mistakes", 120, 22),
          row("react native developer india", 500, 3),
          row("vibe coding", 2000, 60),
        ],
        suggestions: ["how to secure a supabase app"],
      },
      { brandTerms: ["Hansraj Saini"] },
    );
    expect(topics.map((t) => t.query)).toEqual([
      "lovable app security audit",
      "supabase rls mistakes",
      "how to secure a supabase app",
    ]);
    expect(topics[0]).toMatchObject({ source: "search-console", score: 290, action: "new" });
  });

  it("marks a query an existing page covers as a refresh, and merges near-duplicates", () => {
    const topics = rankTopics({
      manual: ["supabase security checklist"],
      suggestions: ["supabase security checklist lovable", "lovable supabase security checklist"],
      pages: [{ title: "Lovable Supabase security checklist", path: "/journal/lovable-supabase-security-checklist" }],
    });
    expect(topics).toEqual([
      expect.objectContaining({ query: "supabase security checklist", action: "refresh", source: "manual" }),
    ]);
  });
});

describe("expandSeeds", () => {
  it("collects suggestions for each seed and question word", async () => {
    const fake = (async (u: string) => {
      const q = new URL(u).searchParams.get("q")!;
      return Response.json([q, [`${q} guide`, "E-bike Range", "rls go away"]]);
    }) as typeof fetch;
    const out = await expandSeeds(["e-bike range"], "en", fake);
    expect(out).not.toContain("rls go away");
    expect(out).toContain("how e-bike range guide");
    expect(out).not.toContain("e-bike range");
    expect(new Set(out).size).toBe(out.length);
  });
});
