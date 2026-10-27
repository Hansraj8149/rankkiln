import type { ExistingPage } from "./index";

const locs = (xml: string) =>
  [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));

/** A readable title from a URL's last path segment, used when the sitemap gives none. */
export function titleFromUrl(url: string): string {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  const words = decodeURIComponent(last).replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Home";
}

/** Every page in a sitemap, following one level of sitemap index. */
export async function readSitemap(url: string, fetchImpl: typeof fetch = fetch): Promise<ExistingPage[]> {
  const get = async (u: string) => {
    const res = await fetchImpl(u, { headers: { "user-agent": "RankkilnBot/0.1 (+https://rankkiln.com)" } });
    if (!res.ok) throw new Error(`Couldn't read ${u} (HTTP ${res.status}).`);
    return res.text();
  };
  const xml = await get(url);
  const urls = /<sitemapindex/i.test(xml) ? (await Promise.all(locs(xml).map(get))).flatMap(locs) : locs(xml);
  return [...new Set(urls)].map((u) => ({ url: u, path: new URL(u).pathname, title: titleFromUrl(u) }));
}
