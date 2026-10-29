import { useEffect, useState } from "react";
import type { SiteProfile } from "@rankkiln/core";
import { api, when, type Draft, type Run, type SiteDetail, type Topic } from "../api";
import { fromConfig, PLATFORM_FORMS, toConfig } from "../platforms";
import { Link, navigate, usePath } from "../router";
import { Badge, Button, Loading, Notice, TextField, useAction, useLoad } from "../ui";
import { cleanProfile, ProfileForm } from "./ProfileForm";

const TABS = [
  ["topics", "Topics"],
  ["drafts", "Drafts"],
  ["connection", "Platform"],
  ["search", "Search Console"],
  ["profile", "Profile"],
  ["runs", "History"],
] as const;
type Tab = (typeof TABS)[number][0];

export function SitePage({ id }: { id: string }) {
  const { query } = usePath();
  const tab = (query.get("tab") as Tab) || "topics";
  const site = useLoad(() => api<SiteDetail>("GET", `/sites/${id}`), [id]);

  if (site.error) return <Notice kind="error">{site.error}</Notice>;
  if (!site.data) return <Loading />;
  const s = site.data;

  return (
    <>
      <div className="head">
        <div>
          <h1>{s.profile.name}</h1>
          <p className="muted">
            <a href={s.profile.url} target="_blank" rel="noreferrer">
              {s.profile.url}
            </a>
            {" · "}
            {s.connection ? `Drafts go to ${s.connection.platform}` : "No platform connected yet"}
            {s.searchConsole?.property ? " · Search Console connected" : ""}
          </p>
        </div>
      </div>
      {!s.connection && tab !== "connection" && (
        <Notice>
          Drafts stay in Rankkiln until you <Link href={`/app/sites/${id}?tab=connection`}>connect a platform</Link>.
        </Notice>
      )}
      <nav className="tabs" aria-label="Site sections">
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/app/sites/${id}?tab=${key}`} className={tab === key ? "on" : ""}>
            {label}
          </Link>
        ))}
      </nav>
      {tab === "topics" && <Topics siteId={id} />}
      {tab === "drafts" && <Drafts siteId={id} />}
      {tab === "connection" && <Connection site={s} reload={site.reload} />}
      {tab === "search" && <SearchConsole site={s} reload={site.reload} />}
      {tab === "profile" && <Profile site={s} reload={site.reload} />}
      {tab === "runs" && <Runs siteId={id} />}
    </>
  );
}

function Topics({ siteId }: { siteId: string }) {
  const topics = useLoad(() => api<Topic[]>("GET", `/sites/${siteId}/topics`), [siteId]);
  const [idea, setIdea] = useState("");
  const action = useAction();
  const [note, setNote] = useState<string | null>(null);

  const write = (topicId?: string) =>
    action.run(async () => {
      await api("POST", `/sites/${siteId}/runs`, topicId ? { topicId } : {});
      setNote("Writing the draft. It takes a few minutes; you'll get an email when it's ready.");
    });

  const queued = topics.data?.filter((t) => t.status === "queued") ?? [];
  return (
    <>
      <div className="card">
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              await api("POST", `/sites/${siteId}/topics`, { query: idea });
              setIdea("");
              await topics.reload();
            });
          }}
        >
          <TextField
            label="Add a topic idea"
            value={idea}
            onChange={setIdea}
            placeholder="what your readers search for"
          />
          <Button type="submit" disabled={!idea || action.busy}>
            Add
          </Button>
        </form>
        <div className="actions">
          <Button
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                const res = await api<{ found: number }>("POST", `/sites/${siteId}/topics/refresh`);
                setNote(`Found ${res.found} topics.`);
                await topics.reload();
              })
            }
          >
            {action.busy ? "Working…" : "Find topics"}
          </Button>
          <Button kind="primary" disabled={action.busy} onClick={() => write()}>
            Write the best topic now
          </Button>
        </div>
        {note && <Notice kind="ok">{note}</Notice>}
        {action.error && <Notice kind="error">{action.error}</Notice>}
      </div>
      {!topics.data ? (
        <Loading />
      ) : queued.length === 0 ? (
        <p className="muted">
          No topics yet. Find topics, add seed keywords in the profile, or connect Search Console.
        </p>
      ) : (
        <ul className="list">
          {queued.map((t) => (
            <li key={t.id} className="row">
              <span>
                <strong>{t.query}</strong>{" "}
                {t.action === "refresh" ? <Badge tone="warn">Improve {t.page}</Badge> : <Badge>New post</Badge>}
                <br />
                <span className="muted small">
                  {t.source === "search-console"
                    ? "Search Console"
                    : t.source === "autocomplete"
                      ? "Autocomplete"
                      : "Your idea"}
                  {" · "}
                  {t.reason}
                </span>
              </span>
              <span className="actions tight">
                <Button
                  disabled={action.busy}
                  onClick={() =>
                    action.run(async () => {
                      await api("PATCH", `/topics/${t.id}`, { status: "rejected" });
                      await topics.reload();
                    })
                  }
                >
                  Skip
                </Button>
                <Button kind="primary" disabled={action.busy} onClick={() => write(t.id)}>
                  Write
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const STATUS: Record<Draft["status"], [string, "plain" | "ok" | "warn" | "bad"]> = {
  ready: ["In Rankkiln", "warn"],
  sent: ["Draft on your site", "plain"],
  published: ["Published", "ok"],
  rejected: ["Rejected", "bad"],
};

function Drafts({ siteId }: { siteId: string }) {
  const drafts = useLoad(() => api<Draft[]>("GET", `/sites/${siteId}/drafts`), [siteId]);
  if (drafts.error) return <Notice kind="error">{drafts.error}</Notice>;
  if (!drafts.data) return <Loading />;
  if (!drafts.data.length) return <p className="muted">No drafts yet. Pick a topic and press Write.</p>;
  return (
    <ul className="list">
      {drafts.data.map((d) => (
        <li key={d.id}>
          <Link className="row" href={`/app/drafts/${d.id}`}>
            <span>
              <strong>{d.title}</strong>
              <br />
              <span className="muted small">
                {d.post.keyword} · {when(d.createdAt)}
              </span>
            </span>
            <Badge tone={STATUS[d.status][1]}>{STATUS[d.status][0]}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Connection({ site, reload }: { site: SiteDetail; reload: () => void }) {
  const [platform, setPlatform] = useState(site.connection?.platform ?? "wordpress");
  const [values, setValues] = useState<Record<string, string>>(
    site.connection ? fromConfig(site.connection.config) : {},
  );
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const action = useAction();
  const form = PLATFORM_FORMS.find((p) => p.id === platform)!;
  const keepsSecret = site.connection?.platform === platform && site.connection.hasSecret;

  const save = () =>
    action.run(async () => {
      setResult(null);
      await api("PUT", `/sites/${site.id}/connection`, {
        platform,
        config: toConfig(values),
        ...(secret ? { secret } : {}),
      });
      const res = await api<{ ok: boolean; reason?: string }>("POST", `/sites/${site.id}/connection/verify`);
      setResult(res.ok ? "Connected. Drafts will go here as unpublished." : null);
      if (!res.ok) action.setError(`Saved, but the check failed: ${res.reason}`);
      setSecret("");
      reload();
    });

  return (
    <div className="card form">
      <label className="field">
        <span>Platform</span>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORM_FORMS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {form.fields.map((f) => (
        <TextField
          key={f.key}
          label={f.optional ? `${f.label} (optional)` : f.label}
          value={values[f.key] ?? ""}
          placeholder={f.placeholder}
          help={f.help}
          onChange={(v) => setValues({ ...values, [f.key]: v })}
        />
      ))}
      <TextField
        label={form.secret.label}
        type="password"
        value={secret}
        onChange={setSecret}
        placeholder={keepsSecret ? "Saved. Leave empty to keep it." : ""}
        help={`${form.secret.help} Stored encrypted.`}
      />
      {result && <Notice kind="ok">{result}</Notice>}
      {action.error && <Notice kind="error">{action.error}</Notice>}
      <div className="actions">
        {site.connection && (
          <Button
            kind="danger"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await api("DELETE", `/sites/${site.id}/connection`);
                reload();
              })
            }
          >
            Disconnect
          </Button>
        )}
        <Button kind="primary" onClick={save} disabled={action.busy}>
          {action.busy ? "Checking…" : "Save and check"}
        </Button>
      </div>
      {site.connection?.verifiedAt && <p className="muted small">Last checked {when(site.connection.verifiedAt)}</p>}
    </div>
  );
}

function SearchConsole({ site, reload }: { site: SiteDetail; reload: () => void }) {
  const { query } = usePath();
  const [property, setProperty] = useState(site.searchConsole?.property ?? "");
  const action = useAction();
  return (
    <div className="card form">
      <p>
        With read-only access to Search Console, Rankkiln finds the searches where your site shows up on page two or
        three, which are the quickest posts to rank. Branded searches (your own name) are left out.
      </p>
      {query.get("gsc") === "connected" && <Notice kind="ok">Search Console connected.</Notice>}
      {query.get("gsc") === "failed" && <Notice kind="error">Google sign-in didn't finish. Try again.</Notice>}
      {site.searchConsole ? (
        <>
          <TextField
            label="Property"
            value={property}
            onChange={setProperty}
            placeholder="sc-domain:example.com"
            help='As Search Console names it: "sc-domain:example.com" or "https://example.com/".'
          />
          {action.error && <Notice kind="error">{action.error}</Notice>}
          <div className="actions">
            <Button
              kind="danger"
              onClick={() =>
                action.run(async () => {
                  await api("DELETE", `/sites/${site.id}/gsc`);
                  reload();
                })
              }
            >
              Disconnect
            </Button>
            <Button
              kind="primary"
              disabled={!property || action.busy}
              onClick={() =>
                action.run(async () => {
                  await api("PUT", `/sites/${site.id}/gsc`, { property });
                  reload();
                })
              }
            >
              Save property
            </Button>
          </div>
        </>
      ) : (
        <a className="btn primary" href={`/api/sites/${site.id}/gsc/connect`}>
          Connect Search Console
        </a>
      )}
    </div>
  );
}

function Profile({ site, reload }: { site: SiteDetail; reload: () => void }) {
  const [profile, setProfile] = useState<SiteProfile>(site.profile);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  useEffect(() => setSaved(false), [profile]);
  return (
    <>
      <div className="card">
        <ProfileForm value={profile} onChange={setProfile} />
      </div>
      {saved && <Notice kind="ok">Saved.</Notice>}
      {action.error && <Notice kind="error">{action.error}</Notice>}
      <div className="actions">
        <Button
          kind="danger"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              if (!window.confirm(`Delete ${site.profile.name} and all its drafts from Rankkiln?`)) return;
              await api("DELETE", `/sites/${site.id}`);
              navigate("/app");
            })
          }
        >
          Delete site
        </Button>
        <Button
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              await api("PUT", `/sites/${site.id}`, { paused: !site.paused });
              reload();
            })
          }
        >
          {site.paused ? "Resume schedule" : "Pause schedule"}
        </Button>
        <Button
          kind="primary"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              await api("PUT", `/sites/${site.id}`, { profile: cleanProfile(profile) });
              setSaved(true);
              reload();
            })
          }
        >
          Save profile
        </Button>
      </div>
    </>
  );
}

function Runs({ siteId }: { siteId: string }) {
  const runs = useLoad(() => api<Run[]>("GET", `/sites/${siteId}/runs`), [siteId]);
  if (!runs.data) return <Loading />;
  if (!runs.data.length) return <p className="muted">Nothing has run yet.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Started</th>
          <th>Topic</th>
          <th>Result</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {runs.data.map((r) => (
          <tr key={r.id}>
            <td>{when(r.createdAt)}</td>
            <td>{r.topic ?? "—"}</td>
            <td>
              <Badge tone={r.status === "done" ? "ok" : r.status === "failed" ? "bad" : "plain"}>{r.status}</Badge>
              {r.error && <div className="small muted">{r.error}</div>}
            </td>
            <td>{r.costUsd ? `$${r.costUsd.toFixed(2)}` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
