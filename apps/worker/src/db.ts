import { createConnector, type Connector, type ConnectorSpec } from "@rankkiln/connectors";
import { siteProfileSchema, type SiteProfile } from "@rankkiln/core";
import { decrypt } from "./crypto";
import type { Env } from "./env";

export const one = <T>(db: D1Database, sql: string, ...args: unknown[]) =>
  db
    .prepare(sql)
    .bind(...args)
    .first<T>();

export const all = async <T>(db: D1Database, sql: string, ...args: unknown[]) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;

export const exec = (db: D1Database, sql: string, ...args: unknown[]) =>
  db
    .prepare(sql)
    .bind(...args)
    .run();

export interface SiteRow {
  id: string;
  account_id: string;
  profile: string;
  paused: number;
  next_run_at: number | null;
  created_at: number;
}

export interface AccountRow {
  id: string;
  plan: string;
  plan_status: string;
  ls_customer_id: string | null;
  ls_subscription_id: string | null;
}

export interface ConnectionRow {
  site_id: string;
  platform: ConnectorSpec["type"];
  config: string;
  secret_enc: string | null;
  verified_at: number | null;
}

export interface TopicRow {
  id: string;
  site_id: string;
  query: string;
  source: string;
  score: number;
  reason: string;
  action: "new" | "refresh";
  page: string | null;
  status: "queued" | "drafted" | "rejected";
  created_at: number;
}

export interface DraftRow {
  id: string;
  site_id: string;
  run_id: string | null;
  slug: string;
  title: string;
  post: string;
  issues: string;
  status: "ready" | "sent" | "published" | "rejected";
  platform_id: string | null;
  review_url: string | null;
  created_at: number;
}

export const parseProfile = (row: SiteRow): SiteProfile => siteProfileSchema.parse(JSON.parse(row.profile));

/** The site's connector with its secret decrypted, or null when none is set. */
export async function siteConnector(env: Env, siteId: string, fetchImpl?: typeof fetch): Promise<Connector | null> {
  const row = await one<ConnectionRow>(env.DB, "SELECT * FROM connections WHERE site_id = ?", siteId);
  if (!row) return null;
  const token = row.secret_enc ? await decrypt(env.RANKKILN_ENCRYPTION_KEY, row.secret_enc) : "";
  return createConnector({ ...JSON.parse(row.config), type: row.platform, token } as ConnectorSpec, fetchImpl);
}

/** Days between runs for a cadence of posts per week. */
export const runInterval = (postsPerWeek: number) => (7 * 86_400_000) / Math.max(1, postsPerWeek);
