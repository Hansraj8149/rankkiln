import { api, when, type Site } from "../api";
import { Link } from "../router";
import { Badge, Loading, Notice, useLoad } from "../ui";

export function SitesPage() {
  const sites = useLoad(() => api<Site[]>("GET", "/sites"));

  return (
    <>
      <div className="head">
        <div>
          <h1>Your sites</h1>
          <p className="muted">Each site has its own profile, platform and posting pace.</p>
        </div>
        <Link className="btn primary" href="/app/sites/new">
          Add a site
        </Link>
      </div>
      {sites.error && <Notice kind="error">{sites.error}</Notice>}
      {!sites.data ? (
        <Loading />
      ) : sites.data.length === 0 ? (
        <div className="card empty">
          <h2>Start with your site's address</h2>
          <p className="muted">
            Rankkiln reads your homepage and sitemap and proposes a profile: who you write for, your voice, and the
            facts a post may state. You check and edit it before anything is written.
          </p>
          <Link className="btn primary" href="/app/sites/new">
            Add a site
          </Link>
        </div>
      ) : (
        <ul className="list">
          {sites.data.map((s) => (
            <li key={s.id}>
              <Link href={`/app/sites/${s.id}`} className="row">
                <span className="site-row">
                  <span className="avatar" aria-hidden="true">
                    {s.profile.name.trim()[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span>
                    <strong>{s.profile.name}</strong>
                    <span className="url">{s.profile.url.replace(/^https?:\/\//, "")}</span>
                  </span>
                </span>
                <span className="muted">
                  {s.paused ? (
                    <Badge tone="warn">Paused</Badge>
                  ) : s.profile.cadence.postsPerWeek ? (
                    `Next draft ${when(s.nextRunAt)}`
                  ) : (
                    "On demand"
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
