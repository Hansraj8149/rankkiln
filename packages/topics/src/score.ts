import type { QueryRow } from "./searchConsole";
import { overlap, similarPages, terms } from "./similar";

export interface TopicCandidate {
  /** The search phrase, as people type it. */
  query: string;
  source: "manual" | "search-console" | "autocomplete";
  score: number;
  /** Plain-words reason shown next to the topic. */
  reason: string;
  impressions?: number;
  position?: number;
  /** The site's page that currently ranks for it, if any. */
  page?: string;
  /** "new" needs a post; "refresh" means an existing page covers it and should be improved instead. */
  action: "new" | "refresh";
}

export interface ScoreOptions {
  /** Words that make a query a search for the brand itself (the site name, the owner's name). */
  brandTerms?: string[];
  /** Search Console positions worth a post. Above the range is already ranking; below it Google doesn't see a fit. */
  positions?: [number, number];
  minImpressions?: number;
}

const isBranded = (query: string, brand: Set<string>) => [...terms(query)].some((t) => brand.has(t));

/**
 * Ranks topic ideas: manual ideas first (a person asked), then Search Console queries the site nearly ranks for,
 * weighted by impressions and closeness to page one, then autocomplete expansions. Drops branded searches and
 * near-duplicates, and marks ideas an existing page already covers as refreshes.
 */
export function rankTopics(
  input: {
    manual?: string[];
    queries?: QueryRow[];
    suggestions?: string[];
    /** The site's pages, by title and path, to spot topics it already covers. */
    pages?: { title: string; path: string }[];
  },
  opts: ScoreOptions = {},
): TopicCandidate[] {
  const brand = new Set((opts.brandTerms ?? []).flatMap((t) => [...terms(t)]));
  const [lo, hi] = opts.positions ?? [8, 30];
  const pages = input.pages ?? [];
  const covered = (q: string) => similarPages(q, pages, 0.75)[0]?.path;
  const out: TopicCandidate[] = [];

  for (const q of input.manual ?? []) {
    const page = covered(q);
    out.push({
      query: q,
      source: "manual",
      score: 1000,
      reason: "Added by hand",
      action: page ? "refresh" : "new",
      ...(page ? { page } : {}),
    });
  }

  // One entry per query: total impressions, the best position, and the page that holds it.
  const byQuery = new Map<string, { impressions: number; position: number; page: string }>();
  for (const r of input.queries ?? []) {
    const cur = byQuery.get(r.query);
    if (!cur) byQuery.set(r.query, { impressions: r.impressions, position: r.position, page: r.page });
    else {
      cur.impressions += r.impressions;
      if (r.position < cur.position) Object.assign(cur, { position: r.position, page: r.page });
    }
  }
  for (const [query, q] of byQuery) {
    if (isBranded(query, brand)) continue;
    if (q.impressions < (opts.minImpressions ?? 10) || q.position < lo || q.position > hi) continue;
    const page = covered(query);
    const path = new URL(q.page).pathname;
    // Closer to page one is worth more: position 8 counts fully, position 30 counts a quarter.
    const closeness = 1 - (0.75 * (q.position - lo)) / Math.max(1, hi - lo);
    out.push({
      query,
      source: "search-console",
      score: Math.round(q.impressions * closeness),
      reason: `${q.impressions} impressions at position ${q.position.toFixed(1)} (${path})`,
      impressions: q.impressions,
      position: q.position,
      page: page ?? path,
      action: page ? "refresh" : "new",
    });
  }

  for (const s of input.suggestions ?? []) {
    if (isBranded(s, brand)) continue;
    const page = covered(s);
    if (page) continue;
    const question = /^(how|what|why|when|which|can|is|do|does|should)\b/.test(s);
    out.push({
      query: s,
      source: "autocomplete",
      score: question ? 8 : 5,
      reason: "People type this into Google",
      action: "new",
    });
  }

  // Keep the best of any near-duplicates ("fix slow checkout" vs "how to fix a slow checkout").
  const kept: TopicCandidate[] = [];
  for (const t of out.sort((a, b) => b.score - a.score)) {
    if (!kept.some((k) => overlap(t.query, k.query) >= 0.8 && overlap(k.query, t.query) >= 0.8)) kept.push(t);
  }
  return kept;
}
