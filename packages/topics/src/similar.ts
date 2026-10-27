const STOP = new Set(
  "a an and are as at be but by can do for from how i in is it its my of on or so that the this to what when why with you your".split(
    " ",
  ),
);

export const terms = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

/** Share of the topic's terms that a page also has (0 to 1). */
export function overlap(topic: string, page: string): number {
  const a = terms(topic);
  if (a.size === 0) return 0;
  const b = terms(page);
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit / a.size;
}

/** Existing pages that look like they already cover the topic, closest first. */
export function similarPages<P extends { title: string; path: string }>(topic: string, pages: P[], min = 0.6): P[] {
  return pages
    .map((p) => ({ p, score: Math.max(overlap(topic, p.title), overlap(topic, p.path)) }))
    .filter((x) => x.score >= min)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.p);
}
