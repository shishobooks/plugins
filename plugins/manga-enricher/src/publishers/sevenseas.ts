import type { PublisherScraper, VolumeMetadata } from "./types";

const USER_AGENT =
  "ShishoPlugin/0.1.0 (manga-enricher; github.com/shishobooks/plugins)";

const BASE_URL = "https://sevenseasentertainment.com";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fetchHtml(url: string): string | null {
  shisho.log.debug(`SevenSeas: fetching ${url}`);
  const response = shisho.http.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response || !response.ok) {
    shisho.log.warn(
      `SevenSeas: HTTP ${response?.status ?? "no response"} ${url}`,
    );
    return null;
  }
  try {
    return response.text();
  } catch {
    shisho.log.warn(`SevenSeas: failed to read response body for ${url}`);
    return null;
  }
}

/**
 * Slugify a title for Seven Seas' URL scheme: lowercase, drop both ASCII
 * and Unicode right-single-quotes, replace non-alphanumeric runs with a
 * single hyphen, trim leading/trailing hyphens. The apostrophe-drop
 * matches Kodansha and the live Seven Seas slugs (verified by
 * /books/rozen-maiden-collectors-edition-vol-5/), and differs from Yen
 * Press, which turns apostrophes into hyphens.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const sevenseasScraper: PublisherScraper = {
  name: "Seven Seas Entertainment",

  matchPublisher(publisherName: string): boolean {
    return /\bseven\s+seas\b/i.test(publisherName);
  },

  searchVolume(
    _seriesTitle: string,
    _volumeNumber: number,
    _edition?: string,
  ): VolumeMetadata | null {
    // Filled in at Task 11.
    return null;
  },
};
