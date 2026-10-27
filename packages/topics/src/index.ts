export interface ExistingPage {
  url: string;
  path: string;
  title: string;
}

export { readSitemap, titleFromUrl } from "./sitemap";
export { overlap, similarPages, terms } from "./similar";
