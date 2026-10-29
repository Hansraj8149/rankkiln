// Google Search Console through OAuth. The site owner signs in once; Rankkiln keeps the refresh token and reads
// search analytics (read-only scope).

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export function gscAuthUrl(client: Pick<GoogleClient, "clientId">, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GSC_SCOPE,
    access_type: "offline",
    // Ask for consent every time so Google always returns a refresh token.
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(body: Record<string, string>, fetchImpl: typeof fetch) {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Google sign-in failed: ${json.error_description ?? res.status}`);
  return json;
}

/** Trades the code from the OAuth redirect for tokens. Keep the refresh token; it doesn't expire on its own. */
export async function exchangeCode(
  client: GoogleClient,
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; refreshToken: string }> {
  const json = await token(
    {
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    },
    fetchImpl,
  );
  if (!json.refresh_token) throw new Error("Google didn't return a refresh token. Remove the app's access and retry.");
  return { accessToken: json.access_token!, refreshToken: json.refresh_token };
}

export async function refreshAccessToken(
  client: GoogleClient,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const json = await token(
    {
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
    },
    fetchImpl,
  );
  return json.access_token!;
}

const API = "https://www.googleapis.com/webmasters/v3";

/** The properties the signed-in account can read, e.g. "sc-domain:acme.com". */
export async function listProperties(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchImpl(`${API}/sites`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Search Console answered HTTP ${res.status}.`);
  const json = (await res.json()) as { siteEntry?: { siteUrl: string; permissionLevel: string }[] };
  return (json.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => s.siteUrl);
}

export interface QueryRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  /** Average position, 1 is the top. */
  position: number;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Query × page rows for the last `days` days (Search Console data lags by about 2 days). */
export async function searchAnalytics(
  accessToken: string,
  property: string,
  opts: { days?: number; rowLimit?: number; now?: Date } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<QueryRow[]> {
  const end = new Date((opts.now ?? new Date()).getTime() - 2 * 86_400_000);
  const start = new Date(end.getTime() - (opts.days ?? 90) * 86_400_000);
  const res = await fetchImpl(`${API}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      startDate: day(start),
      endDate: day(end),
      dimensions: ["query", "page"],
      rowLimit: opts.rowLimit ?? 5000,
    }),
  });
  if (!res.ok) throw new Error(`Search Console answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as {
    rows?: { keys: [string, string]; clicks: number; impressions: number; position: number }[];
  };
  return (json.rows ?? []).map((r) => ({
    query: r.keys[0],
    page: r.keys[1],
    clicks: r.clicks,
    impressions: r.impressions,
    position: r.position,
  }));
}
