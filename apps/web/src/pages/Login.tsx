import { useState } from "react";
import { api } from "../api";
import { usePath } from "../router";
import { Button, Logo, Notice, TextField, ThemeSwitch, useAction } from "../ui";

export function LoginPage() {
  const { query } = usePath();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const action = useAction();

  const submit = async () => {
    if (await action.run(() => api("POST", "/auth/start", { email }))) setSent(true);
  };

  return (
    <main className="auth">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-top">
        <a className="brand" href="/">
          <Logo />
          <span>Rankkiln</span>
        </a>
        <ThemeSwitch />
      </div>
      <div className="auth-card">
        {sent ? (
          <div className="sent">
            <span className="sent-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
            </span>
            <h1>Check your inbox</h1>
            <p className="muted">
              We sent a sign-in link to <strong>{email}</strong>. It works once and expires in 15 minutes.
            </p>
            <Button onClick={() => setSent(false)}>Use another email</Button>
          </div>
        ) : (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div>
              <h1>Sign in</h1>
              <p className="muted">We'll email you a link. New here? The same link creates your account.</p>
            </div>
            {query.get("error") && <Notice kind="error">{query.get("error")}</Notice>}
            <TextField label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
            {action.error && <Notice kind="error">{action.error}</Notice>}
            <Button kind="primary" type="submit" className="block" disabled={action.busy || !email}>
              {action.busy ? "Sending…" : "Email me a link"}
            </Button>
          </form>
        )}
      </div>
      <p className="auth-foot muted small">Two free posts to start. No card needed.</p>
    </main>
  );
}
