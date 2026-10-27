import type { Block, Post } from "@rankkiln/core";

function block(b: Block): string {
  switch (b.type) {
    case "heading":
      return `${"#".repeat(b.level)} ${b.text}`;
    case "paragraph":
      return b.text;
    case "list":
      return b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : "-"} ${it}`).join("\n");
    case "quote":
      return `> ${b.text}${b.cite ? `\n>\n> — ${b.cite}` : ""}`;
    case "code":
      return "```" + (b.lang ?? "") + "\n" + b.code + "\n```";
    case "callout":
      return `> **Note:** ${b.text}`;
    case "image":
      return `![${b.alt}](${b.src})${b.caption ? `\n*${b.caption}*` : ""}`;
    case "cta":
      return `${b.text}\n\n[${b.label}](${b.href})`;
  }
}

const yamlString = (s: string) => JSON.stringify(s);

/** The post as Markdown with YAML front matter (for GitHub-based sites and for reading a dry run). */
export function renderMarkdown(post: Post): string {
  const front = [
    "---",
    `title: ${yamlString(post.title)}`,
    `metaTitle: ${yamlString(post.metaTitle)}`,
    `description: ${yamlString(post.description)}`,
    `slug: ${post.slug}`,
    `keyword: ${yamlString(post.keyword)}`,
    `language: ${post.language}`,
    `tags: [${post.tags.map(yamlString).join(", ")}]`,
    "draft: true",
    "---",
  ].join("\n");
  const faq = post.faq.length
    ? "\n\n## Frequently asked questions\n\n" + post.faq.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n")
    : "";
  return `${front}\n\n# ${post.title}\n\n${post.blocks.map(block).join("\n\n")}${faq}\n`;
}
