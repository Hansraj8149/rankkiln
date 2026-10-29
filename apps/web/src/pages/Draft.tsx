import { useState } from "react";
import { renderHtml } from "@rankkiln/connectors";
import type { Post } from "@rankkiln/core";
import { api, when, type Draft, type SiteDetail } from "../api";
import { Link } from "../router";
import { Badge, Button, Loading, Notice, TextField, useAction, useLoad } from "../ui";

export function DraftPage({ id }: { id: string }) {
  const draft = useLoad(() => api<Draft>("GET", `/drafts/${id}`), [id]);
  const site = useLoad(
    () => (draft.data ? api<SiteDetail>("GET", `/sites/${draft.data.siteId}`) : Promise.resolve(null)),
    [draft.data?.siteId],
  );
  const [edit, setEdit] = useState<Post | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const action = useAction();

  if (draft.error) return <Notice kind="error">{draft.error}</Notice>;
  if (!draft.data || !site.data) return <Loading />;
  const d = draft.data;
  const s = site.data;
  const post = edit ?? d.post;
  const errors = d.issues.filter((i) => i.severity === "error");
  const claims = post.claimsToVerify;
  const allChecked = claims.every((_, i) => checked.has(i));
  const searchTitle = post.metaTitle + s.profile.titleSuffix;

  const act = (fn: () => Promise<unknown>) =>
    action.run(async () => {
      await fn();
      await draft.reload();
    });

  return (
    <>
      <p className="muted">
        <Link href={`/app/sites/${d.siteId}?tab=drafts`}>← {s.profile.name}</Link> · {when(d.createdAt)}
      </p>
      <div className="head">
        <h1>{post.title}</h1>
        <Badge tone={d.status === "published" ? "ok" : d.status === "rejected" ? "bad" : "plain"}>{d.status}</Badge>
      </div>

      <section className="card">
        <h2 className="h3">In search results</h2>
        <div className="serp">
          <div className="serp-url">
            {s.profile.url.replace(/^https?:\/\//, "")} › {post.slug}
          </div>
          <div className={`serp-title ${searchTitle.length > 60 ? "over" : ""}`}>{searchTitle}</div>
          <div className="serp-desc">{post.description}</div>
        </div>
        <p className="muted small">
          Title {searchTitle.length}/60 · Description {post.description.length}/160 · Keyword “{post.keyword}”
        </p>
      </section>

      {d.issues.length > 0 && (
        <section className="card">
          <h2 className="h3">Checks</h2>
          <ul className="issues">
            {d.issues.map((i, n) => (
              <li key={n} className={i.severity}>
                {i.severity === "error" ? "Must fix: " : "Worth a look: "}
                {i.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {claims.length > 0 && (
        <section className="card">
          <h2 className="h3">Check these before publishing</h2>
          {claims.map((c, i) => (
            <label key={i} className="check">
              <input
                type="checkbox"
                checked={checked.has(i)}
                onChange={(e) => {
                  const next = new Set(checked);
                  if (e.target.checked) next.add(i);
                  else next.delete(i);
                  setChecked(next);
                }}
              />
              <span>{c}</span>
            </label>
          ))}
        </section>
      )}

      {edit ? (
        <section className="card form">
          <TextField label="Title" value={edit.title} onChange={(title) => setEdit({ ...edit, title })} />
          <TextField
            label="Search title"
            value={edit.metaTitle}
            onChange={(metaTitle) => setEdit({ ...edit, metaTitle })}
          />
          <TextField
            label="Description"
            multiline
            value={edit.description}
            onChange={(description) => setEdit({ ...edit, description })}
          />
          {edit.blocks.map((b, i) =>
            "text" in b && b.type !== "cta" ? (
              <TextField
                key={i}
                label={b.type === "heading" ? `Heading (H${b.level})` : b.type[0]!.toUpperCase() + b.type.slice(1)}
                multiline={b.type !== "heading"}
                rows={b.type === "paragraph" ? 4 : 2}
                value={b.text}
                onChange={(text) =>
                  setEdit({
                    ...edit,
                    blocks: edit.blocks.map((x, j) => (j === i ? { ...x, text } : x)) as Post["blocks"],
                  })
                }
              />
            ) : null,
          )}
          <div className="actions">
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button
              kind="primary"
              disabled={action.busy}
              onClick={() =>
                act(async () => {
                  await api("PUT", `/drafts/${d.id}`, { post: edit });
                  setEdit(null);
                })
              }
            >
              Save changes
            </Button>
          </div>
        </section>
      ) : (
        <article className="card prose" dangerouslySetInnerHTML={{ __html: renderHtml(post) }} />
      )}

      {action.error && <Notice kind="error">{action.error}</Notice>}
      {d.status !== "published" && d.status !== "rejected" && (
        <div className="actions sticky">
          <Button kind="danger" disabled={action.busy} onClick={() => act(() => api("POST", `/drafts/${d.id}/reject`))}>
            Reject
          </Button>
          {d.status === "ready" && !edit && <Button onClick={() => setEdit(structuredClone(d.post))}>Edit</Button>}
          {d.status === "sent" && d.reviewUrl && (
            <a className="btn secondary" href={d.reviewUrl} target="_blank" rel="noreferrer">
              Open on {s.connection?.platform ?? "your site"}
            </a>
          )}
          {d.status === "ready" && s.connection && (
            <Button
              disabled={action.busy || errors.length > 0}
              onClick={() => act(() => api("POST", `/drafts/${d.id}/send`))}
            >
              Send as draft
            </Button>
          )}
          {s.connection && (
            <Button
              kind="primary"
              disabled={action.busy || errors.length > 0 || !allChecked}
              title={!allChecked ? "Tick every claim first" : undefined}
              onClick={() => act(() => api("POST", `/drafts/${d.id}/approve`))}
            >
              Publish
            </Button>
          )}
        </div>
      )}
      {d.status !== "published" && !allChecked && claims.length > 0 && (
        <p className="muted small">Publishing unlocks when every claim above is ticked.</p>
      )}
    </>
  );
}
