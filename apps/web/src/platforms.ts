// What each platform's connection form asks for. Keys match the connector configs in @rankkiln/connectors.

export interface Field {
  key: string;
  label: string;
  placeholder?: string;
  optional?: boolean;
  help?: string;
}

export interface PlatformForm {
  id: string;
  name: string;
  fields: Field[];
  secret: { label: string; help: string };
}

export const PLATFORM_FORMS: PlatformForm[] = [
  {
    id: "wordpress",
    name: "WordPress",
    fields: [
      { key: "url", label: "Site address", placeholder: "https://blog.example.com" },
      { key: "username", label: "Username", placeholder: "editor" },
    ],
    secret: {
      label: "Application password",
      help: "In WordPress: Users → Profile → Application passwords. Not your login password.",
    },
  },
  {
    id: "ghost",
    name: "Ghost",
    fields: [{ key: "url", label: "Site address", placeholder: "https://blog.example.com" }],
    secret: {
      label: "Admin API key",
      help: "In Ghost: Settings → Integrations → Add custom integration. Copy the Admin API key.",
    },
  },
  {
    id: "webflow",
    name: "Webflow",
    fields: [
      { key: "collectionId", label: "Blog collection id" },
      { key: "fields.body", label: "Body field slug", placeholder: "post-body" },
      { key: "fields.summary", label: "Summary field slug", placeholder: "post-summary", optional: true },
      { key: "fields.metaTitle", label: "SEO title field slug", optional: true },
      { key: "fields.metaDescription", label: "SEO description field slug", optional: true },
      { key: "siteUrl", label: "Site address", placeholder: "https://example.com" },
      { key: "urlPrefix", label: "Post URL prefix", placeholder: "/blog/", optional: true },
    ],
    secret: {
      label: "Site API token",
      help: "In Webflow: Site settings → Apps & integrations → API access, with CMS read and write.",
    },
  },
  {
    id: "shopify",
    name: "Shopify",
    fields: [
      { key: "shop", label: "Store subdomain", placeholder: "acme", help: "The part before .myshopify.com" },
      { key: "blogId", label: "Blog id", help: "Online Store → Blog posts → Manage blogs; the number in the address." },
      { key: "author", label: "Author name" },
      { key: "siteUrl", label: "Storefront address", placeholder: "https://acme.com", optional: true },
    ],
    secret: {
      label: "Admin API access token",
      help: "From a custom app (Settings → Apps → Develop apps) with read_content and write_content.",
    },
  },
  {
    id: "github",
    name: "GitHub (Markdown)",
    fields: [
      { key: "repo", label: "Repository", placeholder: "owner/repo" },
      { key: "dir", label: "Posts folder", placeholder: "content/blog" },
      { key: "extension", label: "File type", placeholder: "md", optional: true, help: "md or mdx" },
      { key: "base", label: "Target branch", optional: true, help: "Defaults to the repo's default branch." },
      { key: "siteUrl", label: "Site address", placeholder: "https://example.com" },
      { key: "urlPrefix", label: "Post URL prefix", placeholder: "/blog/", optional: true },
    ],
    secret: {
      label: "Fine-grained token",
      help: "Limited to this repo, with Contents and Pull requests set to read and write.",
    },
  },
  {
    id: "webhook",
    name: "Webhook (any CMS)",
    fields: [
      { key: "url", label: "Endpoint", placeholder: "https://cms.example.com/api/ingest" },
      { key: "listUrl", label: "List endpoint", optional: true, help: "Returns your published posts as JSON." },
    ],
    secret: { label: "Bearer token", help: "Sent as Authorization: Bearer <token>. Optional." },
  },
];

/** Flat form values ("fields.body") to the nested config the connector expects. */
export function toConfig(values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!v.trim()) continue;
    const [head, sub] = k.split(".");
    if (sub) out[head!] = { ...((out[head!] as object) ?? {}), [sub]: v.trim() };
    else out[k] = v.trim();
  }
  return out;
}

export function fromConfig(config: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    if (v && typeof v === "object") for (const [s, sv] of Object.entries(v)) out[`${k}.${s}`] = String(sv);
    else out[k] = String(v);
  }
  return out;
}
