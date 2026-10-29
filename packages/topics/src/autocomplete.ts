// What people type after a seed keyword, from Google's public suggest endpoint. No demand numbers, so these rank
// below Search Console queries that already have impressions.
import { terms } from "./similar";

const MODIFIERS = ["", "how", "what", "why", "best", "vs", "for", "cost", "without"];

export async function suggest(q: string, lang = "en", fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${lang}&q=${encodeURIComponent(q)}`;
  const res = await fetchImpl(url, { headers: { "user-agent": "RankkilnBot/0.1 (+https://rankkiln.hansrajsaini.com)" } });
  if (!res.ok) throw new Error(`Autocomplete answered HTTP ${res.status}.`);
  const body = (await res.json()) as [string, string[]];
  return body[1] ?? [];
}

/** Suggestions for each seed, with and without question words around it. Lowercased and de-duplicated. */
export async function expandSeeds(seeds: string[], lang = "en", fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const queries = seeds.flatMap((seed) =>
    MODIFIERS.map((m) => ({
      seed,
      q: !m ? seed : ["vs", "for", "cost", "without"].includes(m) ? `${seed} ${m}` : `${m} ${seed}`,
    })),
  );
  const out = new Set<string>();
  // A few at a time, so a long seed list doesn't look like a flood.
  for (let i = 0; i < queries.length; i += 4) {
    const batch = await Promise.all(
      queries.slice(i, i + 4).map(async ({ seed, q }) => ({
        seed,
        found: await suggest(q, lang, fetchImpl).catch(() => [] as string[]),
      })),
    );
    for (const { seed, found } of batch) {
      // Keep only suggestions with every word of the seed: "supabase rls" must not drift to "does rls go away".
      const need = [...terms(seed)];
      for (const s of found) {
        const have = terms(s);
        if (need.every((t) => have.has(t))) out.add(s.toLowerCase().trim());
      }
    }
  }
  for (const seed of seeds) out.delete(seed.toLowerCase().trim());
  return [...out].filter(Boolean);
}
