export interface ExistingPage {
  url: string;
  path: string;
  title: string;
}

export { readSitemap, titleFromUrl } from "./sitemap";
export { overlap, similarPages, terms } from "./similar";
export { expandSeeds, suggest } from "./autocomplete";
export { rankTopics, type ScoreOptions, type TopicCandidate } from "./score";
export {
  exchangeCode,
  GSC_SCOPE,
  gscAuthUrl,
  listProperties,
  refreshAccessToken,
  searchAnalytics,
  type GoogleClient,
  type QueryRow,
} from "./searchConsole";
