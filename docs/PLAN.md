# Plan: Rankkiln, an automated SEO blog writer anyone can plug into their site

## Context

Hansraj wants a blog-writing system he can **sell**, not a tool for his own sites: any product owner connects their
platform, sets a little configuration, and gets researched, SEO-ready drafts on a schedule. HS, Yoga with Latu and
Cab in Jaipur become the first three customers (dogfooding).

Decisions made:

- **Name:** Rankkiln. rankkiln.com and rankkiln.io were unregistered on 2026-10-27, and the name lives in one constant.
- **Repo:** public GitHub repo `Hansraj8149/rankkiln`, cloned at `~/Desktop/hansraj/rankkiln`.
- **Shape:** hosted SaaS first. The engine is built as packages so a self-hosted kit (CLI plus a config file) comes
  almost for free.
- **AI:** Claude. A plan's posts are included under the platform key, and customers can also bring their own key.
- **Review:** drafts are approved by a person by default. Auto-publish is a per-site switch that starts off, which
  protects customers from Google's scaled-content penalties and from invented claims.
- **Connectors at launch:** Webhook/API, WordPress, GitHub (Markdown/MDX pull request), Ghost, Webflow, Shopify.

What exists to reuse: the three CMSes already have a copy-paste ChatGPT flow (`gptIdeasPrompt`, `gptPrompt`,
`parseGptAnswer`, `similarPosts`, `textToBlocks` in `Hansraj-Studio/cms/public/app.js`) and a Google check
(`seoReport()` in `cms/src/index.ts`). Their prompt rules, the duplicate check and the lint limits seed the core.

## Architecture (pnpm + turbo monorepo, Cloudflare like the other projects)

```
rankkiln/
  packages/core         pipeline: topic → brief → draft → lint → repair → render; Post + SiteProfile schemas (zod)
  packages/llm          provider interface; Anthropic implementation (platform key or BYO), prompt caching
  packages/topics       Search Console (OAuth), Google autocomplete, sitemap crawl, manual queue; scoring
  packages/lint         deterministic SEO + honesty checks, shared by engine, CLI and dashboard
  packages/connectors   one module per platform: verify(), listExisting(), createDraft(), publish()
                        webhook · wordpress · github · ghost · webflow · shopify
  apps/worker           multi-tenant API + Cron Triggers + Queues; D1 + R2; encrypted credentials
  apps/web              dashboard + marketing site (Next.js on OpenNext)
  apps/cli              self-hosted: rankkiln.config.ts + `rankkiln run|draft|topics`
```

### How a run works

1. **Pick a topic.** Search Console queries ranking at positions 8–30 with no dedicated post, plus autocomplete
   expansions of seed keywords, plus manual ideas. Score = demand × fit × not covered yet. Dedupe against the posts
   `listExisting()` returns.
2. **Brief.** Claude sets the search intent, title, outline, FAQ and 3+ internal links, chosen from the customer's
   sitemap or posts.
3. **Draft.** Claude writes in a neutral block format (heading, paragraph, list, quote, code, callout, image, FAQ,
   CTA), from the site profile. Its output includes a `claimsToVerify` list.
4. **Lint.** Title ≤60 chars, description ≤160, keyword in the title and first paragraph, heading rhythm, internal
   links that resolve, 900–1,800 words, banned and hype words, alt text, no duplicate slug. If a check fails, one
   repair pass runs; anything still failing is flagged.
5. **Render and deliver.** The connector turns the blocks into its own format (WP blocks/HTML, Ghost Lexical/HTML,
   Webflow CMS fields, Shopify article HTML, MDX with frontmatter, or webhook JSON) and creates a **draft** on the
   customer's platform.
6. **Notify.** An email (Resend) says the draft is ready, with a preview link and the claims to verify. The
   customer approves on their platform, or in the Rankkiln review screen, which pushes the post live.

### Site profile (the "little configuration")

Onboarding asks for a URL. Rankkiln crawls the homepage, about page and sitemap and proposes a profile, which the
customer edits:

- audience
- voice and person ("I" or "we")
- languages
- products and facts it may cite
- banned words
- CTA
- seed keywords
- cadence
- categories

The CLI keeps the same profile in `rankkiln.config.ts`.

### Multi-tenant data (D1)

- `accounts` and `users`: magic-link sign-in through Resend.
- `sites`: the profile.
- `connections`: platform credentials, AES-GCM encrypted with a Worker secret.
- `gsc_tokens`
- `topics`
- `runs`: status and cost.
- `drafts`
- `usage`: posts and tokens per month.
- `api_keys`: BYO Anthropic keys, encrypted.

Cron enqueues due sites, and a Queue consumer runs one site at a time, so one customer's failure can't block the
others.

### Honesty and quality (selling point, not just a guard)

- Never invents statistics, customer names, testimonials or prices. It cites only facts from the profile.
- Every draft lists the claims a person should check.
- Images come only from the customer's own media or an optional stock source with credit. It never makes AI images
  of real-looking people or places.
- Each site has a posting cap and its own review queue.

### Billing (decided later in phase 4)

- Plans by posts per month, with a cheaper BYO-key tier.
- Merchant of record (Paddle or Lemon Squeezy), since Hansraj sells from India to international customers.

## Phases

**Phase 0: repo (first step after approval)**

- `~/Desktop/hansraj/rankkiln` with pnpm/turbo, TypeScript, eslint and vitest.
- README, a LICENSE (AGPL-3.0 by default for open core; can change before the first push) and `.env.example`.
- Then `gh repo create Hansraj8149/rankkiln --public` and push.

**Phase 1: engine + CLI + webhook (works self-hosted end to end)**

- `core`, `llm`, `lint`, the `webhook` and `github` connectors, and `apps/cli`.
- A profile for HS. `rankkiln draft --site hs --dry-run` prints a linted draft.

**Phase 2: dogfood on the three sites**

- Add a small token-protected `POST /api/ingest` to each CMS that saves posts as hidden drafts: Hansraj-Studio
  `cms/src/index.ts`, yogawithlatu `apps/cms/src/index.ts`, guideeasy `cms/src/index.ts`.
- Cab in Jaipur also needs a migration for keywords, FAQ and updated date on `blog_posts`.
- Connect all three through the webhook connector.

**Phase 3: hosted engine**

- `apps/worker`: D1 schema, encrypted connections, Cron + Queues, and the topic sources (Search Console OAuth,
  autocomplete, sitemap).
- Connectors: WordPress (application passwords), Ghost (Admin API), Webflow (CMS API v2), Shopify (Admin GraphQL
  articles).

**Phase 4: dashboard + launch**

- `apps/web` covers onboarding (URL → proposed profile), connections, the topic queue, draft review and preview,
  usage, the BYO key and billing.
- A marketing page on rankkiln.com.

## Verification

- **Unit tests:** lint rules, the scoring, and each connector's render (snapshot tests). Contract tests against mocked
  APIs.
- **Real-platform tests:** a local WordPress (wp-env) and a Ghost Docker container. Webflow, Shopify and GitHub use
  free test sites/stores and a scratch repo.
- **Phase 1:** a dry run for HS gives a draft that passes lint. A webhook run then creates a hidden draft in the local
  HS CMS (`pnpm cms:dev`), which passes the CMS Google check and its Preview at 390 and 1440.
- **Phases 3–4:** `wrangler dev` with a test account runs cron → queue → draft on the WordPress test site and sends the
  notification email. Playwright screenshots of the dashboard at 390×844 and 1440×900, with console and overflow
  checks.

## Open items for Hansraj

- Buy rankkiln.com (and .io) soon.
- Anthropic API key for the platform, and a monthly spend cap.
- License: AGPL-3.0 (open core) or something else.
- Google Cloud project for Search Console OAuth. Verifying the app needs a privacy policy on rankkiln.com.
- Paddle vs Lemon Squeezy, decided at phase 4.
