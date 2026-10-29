export interface RunMessage {
  siteId: string;
  /** A queued topic to write. Without one, the run picks the best new topic itself. */
  topicId?: string;
  runId: string;
}

export interface Env {
  DB: D1Database;
  RUNS: Queue<RunMessage>;
  ASSETS: Fetcher;

  /** Public address of the app, e.g. https://rankkiln.com. Used in emails and OAuth redirects. */
  APP_URL: string;
  /** Platform key for plans that include posts. */
  ANTHROPIC_API_KEY: string;
  RANKKILN_MODEL?: string;
  RESEND_API_KEY: string;
  RANKKILN_FROM_EMAIL: string;
  /** 32 random bytes, base64. Encrypts platform secrets, Google tokens and customers' own API keys. */
  RANKKILN_ENCRYPTION_KEY: string;
  /** A "Web application" OAuth client whose redirect URI is APP_URL/api/gsc/callback. */
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;

  LEMONSQUEEZY_API_KEY: string;
  LEMONSQUEEZY_STORE_ID: string;
  LEMONSQUEEZY_WEBHOOK_SECRET: string;
  /** JSON map of plan id to Lemon Squeezy variant id, e.g. {"starter":"123","growth":"456","byok":"789"}. */
  LEMONSQUEEZY_VARIANTS: string;
}
