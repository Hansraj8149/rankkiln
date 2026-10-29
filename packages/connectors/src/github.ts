import type { Post } from "@rankkiln/core";
import { base64, requestJson, trimSlash, verifyBy } from "./http";
import type { Connector, DraftRef, ExistingPost } from "./index";
import { renderMarkdown } from "./markdown";

export interface GitHubConfig {
  /** "owner/repo" */
  repo: string;
  /** A fine-grained token with Contents and Pull requests write access to this repo only. */
  token: string;
  /** Folder that holds the posts, e.g. "content/blog". */
  dir: string;
  extension?: "md" | "mdx";
  /** Branch the pull request targets. Defaults to the repo's default branch. */
  base?: string;
  /** Public address of a post is siteUrl + urlPrefix + slug, e.g. https://example.com + /blog/. */
  siteUrl: string;
  urlPrefix?: string;
}

/** Markdown/MDX sites in a GitHub repo. A draft is an open draft pull request that adds the post file. */
export class GitHubConnector implements Connector {
  readonly platform = "github" as const;

  constructor(
    private config: GitHubConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private api<T>(path: string, init: RequestInit = {}) {
    return requestJson<T>(this.fetchImpl, "GitHub", `https://api.github.com/repos/${this.config.repo}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.config.token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "Rankkiln",
      },
    });
  }

  private get dir() {
    return this.config.dir.replace(/^\/+|\/+$/g, "");
  }

  private async base(): Promise<string> {
    return this.config.base ?? (await this.api<{ default_branch: string }>("")).default_branch;
  }

  verify() {
    return verifyBy(async () => {
      const repo = await this.api<{ permissions?: { push?: boolean } }>("");
      if (repo.permissions && !repo.permissions.push)
        throw new Error("The token can read the repo but not write to it.");
    });
  }

  async listExisting(): Promise<ExistingPost[]> {
    const files = await this.api<{ name: string; type: string }[]>(`/contents/${this.dir}`);
    const prefix = this.config.urlPrefix ?? "/blog/";
    return files
      .filter((f) => f.type === "file" && /\.mdx?$/.test(f.name))
      .map((f) => {
        const slug = f.name.replace(/\.mdx?$/, "");
        return { url: `${trimSlash(this.config.siteUrl)}${prefix}${slug}`, slug, title: slug.replace(/-/g, " ") };
      });
  }

  async createDraft(post: Post): Promise<DraftRef> {
    const base = await this.base();
    const { object } = await this.api<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(base)}`);
    const branch = `rankkiln/${post.slug}`;
    await this.api("/git/refs", {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: object.sha }),
    });
    const file = `${this.dir}/${post.slug}.${this.config.extension ?? "md"}`;
    await this.api(`/contents/${file}`, {
      method: "PUT",
      body: JSON.stringify({ message: `Add draft: ${post.title}`, content: base64(renderMarkdown(post)), branch }),
    });
    const pr = await this.api<{ number: number; html_url: string }>("/pulls", {
      method: "POST",
      body: JSON.stringify({
        title: post.title,
        head: branch,
        base,
        draft: true,
        body: [
          `New post drafted by Rankkiln. Keyword: **${post.keyword}**.`,
          "",
          "Claims to check before merging:",
          ...(post.claimsToVerify.length ? post.claimsToVerify.map((c) => `- [ ] ${c}`) : ["- (none listed)"]),
          "",
          "The file has `draft: true` in its front matter; flip it when you publish.",
        ].join("\n"),
      }),
    });
    return { id: String(pr.number), reviewUrl: pr.html_url };
  }

  async publish(ref: DraftRef): Promise<void> {
    const pr = await this.api<{ node_id: string; draft: boolean; head: { ref: string } }>(`/pulls/${ref.id}`);
    const branch = pr.head.ref;

    // Flip the front matter so the site shows the post once it's merged.
    const files = await this.api<{ filename: string }[]>(`/pulls/${ref.id}/files`);
    for (const { filename } of files.filter((f) => /\.mdx?$/.test(f.filename))) {
      const path = `/contents/${filename}?ref=${encodeURIComponent(branch)}`;
      const file = await this.api<{ sha: string; content: string }>(path);
      const text = new TextDecoder().decode(
        Uint8Array.from(atob(file.content.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
      );
      if (!/^draft: true$/m.test(text)) continue;
      await this.api(`/contents/${filename}`, {
        method: "PUT",
        body: JSON.stringify({
          message: "Publish",
          content: base64(text.replace(/^draft: true$/m, "draft: false")),
          sha: file.sha,
          branch,
        }),
      });
    }

    // REST can't take a pull request out of draft; GraphQL can.
    if (pr.draft)
      await requestJson(this.fetchImpl, "GitHub", "https://api.github.com/graphql", {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.token}`, "user-agent": "Rankkiln" },
        body: JSON.stringify({
          query:
            "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }",
          variables: { id: pr.node_id },
        }),
      });
    await this.api(`/pulls/${ref.id}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash" }) });
  }
}
