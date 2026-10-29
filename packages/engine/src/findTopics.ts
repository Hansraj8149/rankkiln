import type { SiteProfile } from "@rankkiln/core";
import { expandSeeds, rankTopics, type ExistingPage, type QueryRow, type TopicCandidate } from "@rankkiln/topics";

export interface FindTopicsInput {
  site: Pick<SiteProfile, "name" | "url" | "seedKeywords" | "languages">;
  pages: ExistingPage[];
  /** Search Console rows, when the site is connected. */
  queries?: QueryRow[];
  manual?: string[];
  /** Topics already drafted or rejected, so they aren't offered again. */
  done?: string[];
  /** Extra brand words besides the site name and domain, e.g. the owner's name. */
  brandTerms?: string[];
  fetchImpl?: typeof fetch;
}

/** Every source combined and ranked: manual ideas, Search Console near-misses, autocomplete expansions. */
export async function findTopics(input: FindTopicsInput): Promise<TopicCandidate[]> {
  const { site } = input;
  const suggestions = site.seedKeywords.length
    ? await expandSeeds(site.seedKeywords, site.languages[0], input.fetchImpl)
    : [];
  const domain = new URL(site.url).hostname.replace(/^www\./, "").split(".")[0]!;
  const done = new Set((input.done ?? []).map((d) => d.toLowerCase()));
  return rankTopics(
    {
      manual: input.manual ?? [],
      queries: input.queries ?? [],
      suggestions,
      pages: input.pages,
    },
    { brandTerms: [site.name, domain, ...(input.brandTerms ?? [])] },
  ).filter((t) => !done.has(t.query.toLowerCase()));
}
