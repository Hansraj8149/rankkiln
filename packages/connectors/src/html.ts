import type { Block, Post } from "@rankkiln/core";

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Block text allows [links](/path), **bold** and `code`; everything else is escaped. */
export function inlineHtml(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) =>
      /^(https?:\/\/|\/|#)/.test(href) ? `<a href="${href}">${text}</a>` : text,
    );
}

function block(b: Block): string {
  switch (b.type) {
    case "heading":
      return `<h${b.level}>${inlineHtml(b.text)}</h${b.level}>`;
    case "paragraph":
      return `<p>${inlineHtml(b.text)}</p>`;
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag}>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</${tag}>`;
    }
    case "quote":
      return `<blockquote><p>${inlineHtml(b.text)}</p>${b.cite ? `<cite>${escapeHtml(b.cite)}</cite>` : ""}</blockquote>`;
    case "code":
      return `<pre><code${b.lang ? ` class="language-${escapeHtml(b.lang)}"` : ""}>${escapeHtml(b.code)}</code></pre>`;
    case "callout":
      return `<aside><p>${inlineHtml(b.text)}</p></aside>`;
    case "image":
      return `<figure><img src="${escapeHtml(b.src)}" alt="${escapeHtml(b.alt)}" loading="lazy">${b.caption ? `<figcaption>${escapeHtml(b.caption)}</figcaption>` : ""}</figure>`;
    case "cta":
      return `<p>${inlineHtml(b.text)}</p><p><a href="${escapeHtml(b.href)}"><strong>${escapeHtml(b.label)}</strong></a></p>`;
  }
}

/** The post body as HTML, without the title (platforms render that themselves). Includes the FAQ. */
export function renderHtml(post: Post): string {
  const faq = post.faq.length
    ? `<h2>Frequently asked questions</h2>` +
      post.faq.map((f) => `<h3>${inlineHtml(f.q)}</h3><p>${inlineHtml(f.a)}</p>`).join("")
    : "";
  return post.blocks.map(block).join("\n") + (faq ? `\n${faq}` : "");
}
