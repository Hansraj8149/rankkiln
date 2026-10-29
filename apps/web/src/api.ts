import type { Post, SiteProfile } from "@rankkiln/core";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status}).`);
  return json as T;
}

export interface Plan {
  id: string;
  name: string;
  postsPerMonth: number;
  sites: number;
  ownKey: boolean;
}

export interface Me {
  email: string;
  plan: Plan;
  planStatus: string;
  plans: Plan[];
  hasSubscription: boolean;
  usage: { month: string; posts: number; costUsd: number };
  apiKey: { last4: string } | null;
}

export interface Site {
  id: string;
  profile: SiteProfile;
  paused: boolean;
  nextRunAt: number | null;
  createdAt: number;
}

export interface SiteDetail extends Site {
  connection: {
    platform: string;
    config: Record<string, string>;
    hasSecret: boolean;
    verifiedAt: number | null;
  } | null;
  searchConsole: { property: string | null } | null;
}

export interface Topic {
  id: string;
  query: string;
  source: "manual" | "search-console" | "autocomplete";
  score: number;
  reason: string;
  action: "new" | "refresh";
  page: string | null;
  status: "queued" | "drafted" | "rejected";
}

export interface Run {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  topic: string | null;
  error: string | null;
  model: string | null;
  costUsd: number;
  createdAt: number;
  finishedAt: number | null;
}

export interface Issue {
  rule: string;
  message: string;
  severity: "error" | "warning";
}

export interface Draft {
  id: string;
  siteId: string;
  slug: string;
  title: string;
  post: Post;
  issues: Issue[];
  status: "ready" | "sent" | "published" | "rejected";
  reviewUrl: string | null;
  createdAt: number;
}

export const when = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
