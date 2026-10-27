# Rankkiln

Researched, SEO-ready blog drafts for any site. Rankkiln finds topics people already search for, writes a draft in
your voice, checks it, and puts it on your platform as an unpublished draft. A person approves every post unless you
switch auto-publish on.

**Status:** early. The plan is in [`docs/PLAN.md`](docs/PLAN.md).

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
| `packages/core`       | Post and site profile schemas, the pipeline                     |
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
cp rankkiln.config.example.ts rankkiln.config.ts      # describe your site
pnpm rankkiln sites
pnpm rankkiln draft --site acme --topic "how far an e-bike goes on one charge" --dry-run
```

The draft is saved to `out/<site>/<slug>.md` (and `.json` with the brief and checks). Without `--dry-run`, it is also
sent to the site's `target` as an unpublished draft.

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
