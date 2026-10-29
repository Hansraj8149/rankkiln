import type { SiteProfile } from "@rankkiln/core";
import { TextField } from "../ui";

const lines = (xs: string[]) => xs.join("\n");
const unlines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
const commas = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Edits every part of a site profile the customer controls. */
export function ProfileForm({ value, onChange }: { value: SiteProfile; onChange: (p: SiteProfile) => void }) {
  const set = (patch: Partial<SiteProfile>) => onChange({ ...value, ...patch });
  const cta = value.cta ?? { text: "", href: "", label: "" };

  return (
    <div className="form">
      <div className="grid2">
        <TextField label="Name" value={value.name} onChange={(name) => set({ name })} />
        <TextField label="Address" value={value.url} onChange={(url) => set({ url })} />
      </div>
      <TextField
        label="Search title suffix"
        value={value.titleSuffix}
        onChange={(titleSuffix) => set({ titleSuffix })}
        help="Added to every search title, and counted in the 60-character limit."
      />
      <TextField label="Who reads it" multiline value={value.audience} onChange={(audience) => set({ audience })} />
      <div className="grid2">
        <label className="field">
          <span>Narrator</span>
          <select
            value={value.voice.person}
            onChange={(e) =>
              set({ voice: { ...value.voice, person: e.target.value as SiteProfile["voice"]["person"] } })
            }
          >
            <option value="I">"I" (one person)</option>
            <option value="we">"We" (a company)</option>
            <option value="neutral">No narrator</option>
          </select>
        </label>
        <TextField
          label="Banned words"
          value={value.voice.bannedWords.join(", ")}
          onChange={(v) => set({ voice: { ...value.voice, bannedWords: commas(v) } })}
          help="Comma-separated."
        />
      </div>
      <TextField label="Tone" value={value.voice.tone} onChange={(tone) => set({ voice: { ...value.voice, tone } })} />
      <TextField
        label="Facts a post may state"
        multiline
        rows={5}
        value={lines(value.facts)}
        onChange={(v) => set({ facts: unlines(v) })}
        help="One per line. Drafts say nothing else about the business, so keep these true and checkable."
      />
      <TextField
        label="Seed keywords"
        multiline
        value={lines(value.seedKeywords)}
        onChange={(v) => set({ seedKeywords: unlines(v) })}
        help="One per line: searches your readers type. Used to find topics."
      />
      <fieldset>
        <legend>Call to action at the end of each post</legend>
        <TextField label="Sentence" value={cta.text} onChange={(text) => set({ cta: { ...cta, text } })} />
        <div className="grid2">
          <TextField label="Button label" value={cta.label} onChange={(label) => set({ cta: { ...cta, label } })} />
          <TextField label="Link" value={cta.href} onChange={(href) => set({ cta: { ...cta, href } })} />
        </div>
      </fieldset>
      <div className="grid2">
        <label className="field">
          <span>Drafts per week</span>
          <select
            value={value.cadence.postsPerWeek}
            onChange={(e) => set({ cadence: { postsPerWeek: Number(e.target.value) } })}
          >
            <option value={0}>Only when I ask</option>
            {[1, 2, 3, 5, 7].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label="Sitemap"
          value={value.sitemapUrl ?? ""}
          onChange={(v) => set({ sitemapUrl: v || undefined })}
          help="Used for internal links and to skip topics you've covered."
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={value.autoPublish} onChange={(e) => set({ autoPublish: e.target.checked })} />
        <span>
          Publish drafts that pass every check without waiting for me. <em>Off is safer: a person catches mistakes.</em>
        </span>
      </label>
    </div>
  );
}

/** Drops an empty call to action so the profile validates. */
export function cleanProfile(p: SiteProfile): SiteProfile {
  const { cta, ...rest } = p;
  return cta && cta.text && cta.href && cta.label ? p : (rest as SiteProfile);
}
