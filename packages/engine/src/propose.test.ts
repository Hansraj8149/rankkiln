import { describe, expect, it } from "vitest";
import { FakeProvider } from "@rankkiln/llm";
import { pageText, proposeProfile } from "./propose";

const site: Record<string, string> = {
  "https://acme.com/":
    '<html><head><title>Acme Bikes</title><meta name="description" content="E-bikes in Example City"></head><body><script>x()</script><h1>Ride further</h1><p>We fix &amp; sell e-bikes.</p><a href="/about-us">About</a></body></html>',
  "https://acme.com/sitemap.xml":
    "<urlset><url><loc>https://acme.com/about-us</loc></url><url><loc>https://acme.com/contact</loc></url></urlset>",
  "https://acme.com/about-us": "<h1>Our story</h1><p>Open since 2015.</p>",
};
const fake = (async (u: string) =>
  new Response(site[u] ?? "", { status: site[u] ? 200 : 404 })) as unknown as typeof fetch;

describe("pageText", () => {
  it("keeps titles, headings and paragraphs and drops scripts", () => {
    const text = pageText(site["https://acme.com/"]!);
    expect(text).toContain("Title: Acme Bikes");
    expect(text).toContain("Description: E-bikes in Example City");
    expect(text).toContain("## Ride further");
    expect(text).toContain("We fix & sell e-bikes.");
    expect(text).not.toContain("x()");
  });
});

describe("proposeProfile", () => {
  it("reads the homepage, about page and sitemap into a profile", async () => {
    const llm = new FakeProvider([
      {
        name: "Acme Bikes",
        audience: "Commuters",
        person: "we",
        tone: "Practical",
        facts: ["Open since 2015."],
        seedKeywords: ["e-bike range"],
        categories: ["Guides"],
        ctaText: "Book a test ride.",
        ctaHref: "/contact",
        ctaLabel: "Book",
      },
    ]);
    const { profile, pages } = await proposeProfile(llm, "https://acme.com/blog", fake);
    expect(profile).toMatchObject({
      id: "acme",
      url: "https://acme.com",
      titleSuffix: " · Acme Bikes",
      voice: { person: "we" },
      sitemapUrl: "https://acme.com/sitemap.xml",
      autoPublish: false,
    });
    expect(pages).toHaveLength(2);
    expect(llm.requests[0]!.prompt).toContain("Open since 2015.");
  });
});
