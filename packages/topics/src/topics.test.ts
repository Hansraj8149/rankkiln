import { describe, expect, it } from "vitest";
import { readSitemap, similarPages, titleFromUrl } from "./index";

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
