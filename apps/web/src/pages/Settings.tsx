import { useState } from "react";
import { api, type Me } from "../api";
import { usePath } from "../router";
import { Button, Notice, TextField, useAction } from "../ui";

export function SettingsPage({ me, reloadMe }: { me: Me; reloadMe: () => void }) {
  const { query } = usePath();
  const [key, setKey] = useState("");
  const [confirm, setConfirm] = useState("");
  const action = useAction();

  const go = (path: string, method = "GET", body?: unknown) =>
    action.run(async () => {
      const { url } = await api<{ url: string }>(method, path, body);
      location.href = url;
    });

  return (
    <>
      <h1>Settings</h1>
      {query.get("billing") === "done" && (
        <Notice kind="ok">
          Thanks. Your plan updates as soon as the payment is confirmed, usually within a minute.
        </Notice>
      )}
      {action.error && <Notice kind="error">{action.error}</Notice>}

      <section className="card">
        <h2 className="h3">Plan</h2>
        <p>
          <strong>{me.plan.name}</strong>: {me.usage.posts} of {me.plan.postsPerMonth} posts used in {me.usage.month},{" "}
          {me.plan.sites} site{me.plan.sites === 1 ? "" : "s"}.
          {me.planStatus !== "active" && <> Status: {me.planStatus}.</>}
        </p>
        {me.hasSubscription ? (
          <Button disabled={action.busy} onClick={() => go("/billing/portal")}>
            Change plan, card or invoices
          </Button>
        ) : (
          <div className="plans">
            {me.plans.map((p) => (
              <div key={p.id} className="plan">
                <strong>{p.name}</strong>
                <p className="muted small">
                  {p.postsPerMonth} posts a month, {p.sites} site{p.sites === 1 ? "" : "s"}
                  {p.ownKey ? ", with your own Anthropic key" : ""}
                </p>
                <Button
                  kind="primary"
                  disabled={action.busy}
                  onClick={() => go("/billing/checkout", "POST", { plan: p.id })}
                >
                  Choose {p.name}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card form">
        <h2 className="h3">Your own Anthropic key</h2>
        <p className="muted">
          With a key saved, posts are written on your Anthropic account instead of ours. The Own key plan requires one.
        </p>
        {me.apiKey && <p>Saved key ending in {me.apiKey.last4}.</p>}
        <TextField
          label="API key"
          type="password"
          value={key}
          onChange={setKey}
          placeholder="sk-ant-…"
          help="Stored encrypted."
        />
        <div className="actions">
          {me.apiKey && (
            <Button
              kind="danger"
              disabled={action.busy}
              onClick={() =>
                action.run(async () => {
                  await api("DELETE", "/api-key");
                  reloadMe();
                })
              }
            >
              Remove key
            </Button>
          )}
          <Button
            kind="primary"
            disabled={!key || action.busy}
            onClick={() =>
              action.run(async () => {
                await api("PUT", "/api-key", { key });
                setKey("");
                reloadMe();
              })
            }
          >
            Save key
          </Button>
        </div>
      </section>

      <section className="card">
        <h2 className="h3">Account</h2>
        <p>Signed in as {me.email}.</p>
        <Button
          onClick={() =>
            action.run(async () => {
              await api("POST", "/auth/logout");
              location.href = "/app/login";
            })
          }
        >
          Sign out
        </Button>
      </section>

      <section className="card form">
        <h2 className="h3">Delete account</h2>
        <p className="muted">
          Deletes your sites, drafts, topics, saved platform credentials, Search Console access and API key, and cancels
          your subscription. Drafts already on your platform stay there. This can't be undone.
        </p>
        <TextField label="Type your email to confirm" type="email" value={confirm} onChange={setConfirm} />
        <div className="actions">
          <Button
            kind="danger"
            disabled={confirm.trim().toLowerCase() !== me.email.toLowerCase() || action.busy}
            onClick={() =>
              action.run(async () => {
                await api("DELETE", "/account", { email: confirm });
                location.href = "/";
              })
            }
          >
            Delete my account
          </Button>
        </div>
      </section>
    </>
  );
}
