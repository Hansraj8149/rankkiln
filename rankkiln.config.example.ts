// Copy to rankkiln.config.ts (it's git-ignored) and describe your own site.
import { defineConfig } from "@rankkiln/engine";

export default defineConfig({
  sites: [
    {
      profile: {
        id: "acme",
        name: "Acme Bikes",
        url: "https://acmebikes.example",
        titleSuffix: " · Acme Bikes",
        sitemapUrl: "https://acmebikes.example/sitemap.xml",
        audience: "Commuters in a hilly city choosing their first e-bike.",
        voice: {
          person: "we",
          tone: "Friendly and practical, like a mechanic who rides every day.",
          bannedWords: ["revolutionary", "game-changer", "seamless"],
        },
        languages: ["en"],
        // The only things a draft may say about the business. Keep them true and checkable.
        facts: [
          "Acme Bikes is a repair shop and e-bike store in Example City, open since 2015.",
          "We service all brands.",
        ],
        cta: {
          text: "Not sure which bike fits your commute? Book a free test ride.",
          href: "/test-ride",
          label: "Book a test ride",
        },
        seedKeywords: ["e-bike for hills", "e-bike battery range"],
      },
      // Optional: send drafts to your CMS. Without it, drafts are saved to out/acme/.
      // target: { type: "webhook", url: "https://cms.acmebikes.example/api/ingest", tokenEnv: "ACME_WEBHOOK_TOKEN" },
    },
  ],
});
