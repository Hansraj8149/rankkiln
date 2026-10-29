import type { Post } from "@rankkiln/core";
import { renderHtml } from "./html";
import { requestJson, verifyBy } from "./http";
import type { Connector, DraftRef, ExistingPost } from "./index";

export interface ShopifyConfig {
  /** The store's myshopify subdomain, e.g. "acme" for acme.myshopify.com. */
  shop: string;
  /** An Admin API access token from a custom app with read_content and write_content. */
  token: string;
  /** The blog's numeric id (Online Store → Blog posts → Manage blogs; it's in the URL). */
  blogId: string;
  author: string;
  /** The storefront address, e.g. https://acme.com. Defaults to the myshopify domain. */
  siteUrl?: string;
}

const API_VERSION = "2025-10";

const ARTICLE_FIELDS = "id handle title blog { handle }";

/** Shopify blog articles through the Admin GraphQL API. Drafts are unpublished articles. */
export class ShopifyConnector implements Connector {
  readonly platform = "shopify" as const;

  constructor(
    private config: ShopifyConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private get blogGid() {
    return `gid://shopify/Blog/${this.config.blogId}`;
  }

  private async gql<T>(query: string, variables: object = {}): Promise<T> {
    const res = await requestJson<{ data?: T; errors?: { message: string }[] }>(
      this.fetchImpl,
      "Shopify",
      `https://${this.config.shop}.myshopify.com/admin/api/${API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-shopify-access-token": this.config.token },
        body: JSON.stringify({ query, variables }),
      },
    );
    if (res.errors?.length || !res.data) throw new Error(`Shopify: ${res.errors?.map((e) => e.message).join("; ")}`);
    return res.data;
  }

  private static userErrors(errors: { message: string }[]) {
    if (errors.length) throw new Error(`Shopify: ${errors.map((e) => e.message).join("; ")}`);
  }

  verify() {
    return verifyBy(() => this.gql(`query($id: ID!) { blog(id: $id) { id } }`, { id: this.blogGid }));
  }

  async listExisting(): Promise<ExistingPost[]> {
    const data = await this.gql<{ blog: { handle: string; articles: { nodes: { handle: string; title: string }[] } } }>(
      `query($id: ID!) { blog(id: $id) { handle articles(first: 250, query: "published_status:published") { nodes { handle title } } } }`,
      { id: this.blogGid },
    );
    const site = (this.config.siteUrl ?? `https://${this.config.shop}.myshopify.com`).replace(/\/+$/, "");
    return data.blog.articles.nodes.map((a) => ({
      url: `${site}/blogs/${data.blog.handle}/${a.handle}`,
      slug: a.handle,
      title: a.title,
    }));
  }

  async createDraft(post: Post): Promise<DraftRef> {
    const data = await this.gql<{
      articleCreate: { article: { id: string } | null; userErrors: { message: string }[] };
    }>(
      `mutation($article: ArticleCreateInput!) { articleCreate(article: $article) { article { ${ARTICLE_FIELDS} } userErrors { field message } } }`,
      {
        article: {
          blogId: this.blogGid,
          title: post.title,
          handle: post.slug,
          body: renderHtml(post),
          summary: post.description,
          tags: post.tags,
          author: { name: this.config.author },
          isPublished: false,
          metafields: [
            { namespace: "global", key: "title_tag", type: "single_line_text_field", value: post.metaTitle },
            { namespace: "global", key: "description_tag", type: "single_line_text_field", value: post.description },
          ],
        },
      },
    );
    ShopifyConnector.userErrors(data.articleCreate.userErrors);
    const id = data.articleCreate.article!.id;
    return {
      id,
      reviewUrl: `https://admin.shopify.com/store/${this.config.shop}/content/articles/${id.split("/").pop()}`,
    };
  }

  async publish(ref: DraftRef): Promise<void> {
    const data = await this.gql<{ articleUpdate: { userErrors: { message: string }[] } }>(
      `mutation($id: ID!) { articleUpdate(id: $id, article: { isPublished: true }) { userErrors { field message } } }`,
      { id: ref.id },
    );
    ShopifyConnector.userErrors(data.articleUpdate.userErrors);
  }
}
