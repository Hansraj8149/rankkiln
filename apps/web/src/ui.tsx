import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/** Loads data on mount and on demand; keeps the last good value while reloading. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => load().then(setData, (e: Error) => setError(e.message)), deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload, setData };
}

/** Runs an action, shows its error, and blocks double clicks while it runs. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function Button({
  kind = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "secondary" | "danger" }) {
  return <button type="button" {...props} className={`btn ${kind} ${props.className ?? ""}`} />;
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  help?: string;
  type?: string;
  multiline?: boolean;
  rows?: number;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.multiline ? (
        <textarea
          value={props.value}
          rows={props.rows ?? 3}
          placeholder={props.placeholder}
          onChange={(e) => props.onChange(e.target.value)}
        />
      ) : (
        <input
          type={props.type ?? "text"}
          value={props.value}
          placeholder={props.placeholder}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
      {props.help && <small>{props.help}</small>}
    </label>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "ok"; children: ReactNode }) {
  return (
    <p className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function Badge({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "ok" | "warn" | "bad" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export const Loading = () => <p className="muted">Loading…</p>;

type ThemeMode = "system" | "light" | "dark";
const THEME_KEY = "rk-theme";

function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** System, light or dark. Same storage key as public/theme.js, which applies it before the first paint. */
export function ThemeSwitch() {
  const [mode, setMode] = useState<ThemeMode>(readTheme);
  const pick = (m: ThemeMode) => {
    setMode(m);
    try {
      localStorage.setItem(THEME_KEY, m);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    if (m === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", m);
  };
  const icons: Record<ThemeMode, ReactNode> = {
    system: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    ),
    light: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
    dark: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
    ),
  };
  return (
    <div className="theme-switch" role="group" aria-label="Colour theme">
      {(["system", "light", "dark"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          aria-label={`${m[0]!.toUpperCase()}${m.slice(1)} theme`}
          title={m[0]!.toUpperCase() + m.slice(1)}
          onClick={() => pick(m)}
        >
          {icons[m]}
        </button>
      ))}
    </div>
  );
}

export function Logo() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path
        d="M16 6.5c.6 3.4 4.8 5.3 4.8 10.1a4.8 4.8 0 0 1-9.6 0c0-2.3 1.2-3.6 2.3-4.8.3 1.6 1.2 2.6 2.2 2.6.2-3 .9-5.3.3-7.9Z"
        fill="var(--accent-fg)"
      />
      <path d="M9.5 24.5h13" stroke="var(--accent-fg)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** A thin bar for usage against a limit. */
export function Meter({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <span className={`meter ${pct >= 100 ? "full" : ""}`} aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
