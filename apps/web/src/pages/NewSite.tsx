import { useState } from "react";
import type { SiteProfile } from "@rankkiln/core";
import { api, type Site } from "../api";
import { navigate } from "../router";
import { Button, Notice, TextField, useAction } from "../ui";
import { cleanProfile, ProfileForm } from "./ProfileForm";

export function NewSitePage() {
  const [url, setUrl] = useState("");
  const [profile, setProfile] = useState<SiteProfile | null>(null);
  const [pages, setPages] = useState(0);
  const read = useAction();
  const save = useAction();

  const propose = () =>
    read.run(async () => {
      const full = /^https?:\/\//.test(url) ? url : `https://${url}`;
      const res = await api<{ profile: SiteProfile; pages: number }>("POST", "/sites/propose", { url: full });
      setProfile(res.profile);
      setPages(res.pages);
    });

  const create = () =>
    save.run(async () => {
      const site = await api<Site>("POST", "/sites", { profile: cleanProfile(profile!) });
      navigate(`/app/sites/${site.id}?tab=connection`);
    });

  return (
    <>
      <h1>Add a site</h1>
      {!profile ? (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            propose();
          }}
        >
          <TextField
            label="Site address"
            value={url}
            onChange={setUrl}
            placeholder="https://example.com"
            help="Rankkiln reads the homepage, an about page and the sitemap. This takes about half a minute."
          />
          {read.error && <Notice kind="error">{read.error}</Notice>}
          <Button kind="primary" type="submit" disabled={read.busy || !url}>
            {read.busy ? "Reading the site…" : "Read my site"}
          </Button>
        </form>
      ) : (
        <>
          <Notice>
            Here's what Rankkiln understood{pages ? ` from ${pages} pages` : ""}. Check every fact: drafts state only
            what's listed here.
          </Notice>
          <div className="card">
            <ProfileForm value={profile} onChange={setProfile} />
          </div>
          {save.error && <Notice kind="error">{save.error}</Notice>}
          <div className="actions">
            <Button onClick={() => setProfile(null)}>Start over</Button>
            <Button kind="primary" onClick={create} disabled={save.busy}>
              {save.busy ? "Saving…" : "Save and connect a platform"}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
