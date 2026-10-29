# Rankkiln

Researched, SEO-ready blog drafts for any site. Rankkiln finds topics people already search for, writes a draft in
your voice, checks it, and puts it on your platform as an unpublished draft. A person approves every post unless you
switch auto-publish on.

**Status:** feature-complete, not yet deployed. The plan is in [`docs/PLAN.md`](docs/PLAN.md).

## How a run works

1. **Topic:** Search Console queries you nearly rank for, autocomplete expansions of your seed keywords, or your own
   ideas, minus anything you've already covered.
2. **Brief and draft:** Claude plans the post (intent, outline, FAQ, internal links) and writes it from your site
   profile.
3. **Checks:** title and description length, keyword placement, length, banned words, links. Every draft lists the
   claims a person should verify. Rankkiln never invents statistics, customers, testimonials or prices.
4. **Delivery:** a draft on your platform (webhook, WordPress, GitHub pull request, Ghost, Webflow or Shopify) and an
   email with the review link.

## Layout

| Path                  | What it is                                                      |
| --------------------- | --------------------------------------------------------------- |
| `packages/core`       | Post and site profile schemas                                   |
| `packages/engine`     | Draft pipeline, topic finding, profile proposal from a URL      |
| `packages/llm`        | Model provider interface (Anthropic first, platform or own key) |
| `packages/topics`     | Topic sources and scoring                                       |
| `packages/lint`       | SEO and honesty checks                                          |
| `packages/connectors` | One connector per platform                                      |
| `apps/worker`         | Hosted API, cron and queues on Cloudflare Workers               |
| `apps/web`            | Dashboard and marketing site                                    |
| `apps/cli`            | Self-hosted command line                                        |

## Try it (self-hosted)

```bash
pnpm install
cp .env.example .env                                  # set ANTHROPIC_API_KEY
pnpm rankkiln init --url https://your-site.com        # proposes a profile; paste it into the config
cp rankkiln.config.example.ts rankkiln.config.ts      # describe your site and pick a target
pnpm rankkiln verify --site acme                      # checks the platform credentials
pnpm rankkiln topics --site acme                      # ranked topic ideas
pnpm rankkiln draft --site acme --topic "how far an e-bike goes on one charge" --dry-run
pnpm rankkiln run --site acme                         # drafts the best new topic and sends it
```

The draft is saved to `out/<site>/<slug>.md` (and `.json` with the brief and checks). Without `--dry-run`, it is also
sent to the site's `target` as an unpublished draft. For Search Console topics, create a Google OAuth client of type
"Desktop app", put its id and secret in `.env`, run `pnpm rankkiln gsc-login` once, and set `searchConsole.property`.

### Targets

| Platform  | What a draft is                             | Secret (`tokenEnv`)                     |
| --------- | ------------------------------------------- | --------------------------------------- |
| webhook   | `POST {event: "draft.created", post}`       | optional bearer token                   |
| wordpress | a post with status `draft`                  | an application password                 |
| ghost     | a draft post (HTML source)                  | an Admin API key                        |
| github    | a draft pull request adding `<slug>.md(x)`  | a fine-grained token for that repo      |
| webflow   | a CMS item with `isDraft`                   | a site API token with CMS read/write    |
| shopify   | an unpublished blog article with SEO fields | an Admin API token (read/write_content) |

A webhook endpoint answers `{id, reviewUrl}` to `draft.created`, anything 2xx to `ping` and `draft.approved`, and can
offer a `listUrl` that returns `[{url, title, slug}]`.

## Hosted (Cloudflare)

`apps/worker` is the API, the hourly cron and the queue consumer; it also serves `apps/web` (the marketing page and the
dashboard at `/app`).

```bash
cd apps/worker
npx wrangler d1 create rankkiln                 # put the id in wrangler.jsonc
npx wrangler queues create rankkiln-runs
npx wrangler queues create rankkiln-runs-dlq
pnpm db:migrate
npx wrangler secret put ANTHROPIC_API_KEY       # and the other secrets listed at the end of wrangler.jsonc
pnpm deploy
```

Locally: copy `.dev.vars.example` to `.dev.vars` (`RESEND_API_KEY=log` prints sign-in links to the terminal), run
`pnpm db:migrate:local` and `pnpm dev`, and open http://localhost:8787.

Billing is Lemon Squeezy: create one subscription product with a variant per plan (`starter`, `growth`, `byok`), put
`{"starter":"<variant id>",…}` in `LEMONSQUEEZY_VARIANTS`, and point a webhook for the `subscription_*` events at
`/api/billing/webhook`. Plan limits live in `apps/worker/src/plans.ts`.

## Develop

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm lint
```

Copy `.env.example` to `.env` for local runs. Never commit keys.

## Licence

AGPL-3.0. You can self-host it; if you offer a modified version as a service, share your changes.
