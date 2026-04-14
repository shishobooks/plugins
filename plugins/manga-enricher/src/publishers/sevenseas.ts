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

/**
 * Build the product-page path for a Seven Seas volume.
 *
 * For non-omnibus requests: `/books/<slug>-vol-<N>/`. The edition (if
 * any, e.g. "Collector's Edition") is appended to the series title before
 * slugifying, matching Yen Press's approach.
 *
 * For omnibus requests (edition contains "omnibus" case-insensitively):
 * `/books/<base-slug>-omnibus-vol-<2N-1>-<2N>/`. Only the 2-in-1 form is
 * handled — Seven Seas' observed omnibus slugs always pair two volumes
 * (Tokyo Revengers Omnibus 1 = vols 1-2, etc.). Three-in-one omnibuses
 * exist but are not handled in this MVP (see follow-up tasks in the spec).
 *
 * Returns null when the title slugifies to an empty string so that
 * punctuation-only queries don't reach the network.
 */
export function buildProductPath(
  seriesTitle: string,
  volumeNumber: number,
  edition?: string,
): string | null {
  const isOmnibus = edition !== undefined && /omnibus/i.test(edition);
  const slugSource =
    edition && !isOmnibus ? `${seriesTitle} ${edition}` : seriesTitle;
  const slug = slugify(slugSource);
  if (!slug) return null;

  if (isOmnibus) {
    const first = 2 * volumeNumber - 1;
    const second = 2 * volumeNumber;
    return `/books/${slug}-omnibus-vol-${first}-${second}/`;
  }

  return `/books/${slug}-vol-${volumeNumber}/`;
}

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

/**
 * Parse a Seven Seas date string into ISO 8601 (midnight UTC). Two
 * formats are accepted, corresponding to the two site template
 * generations we've observed:
 *
 *   1. "November 14, 2023" — newer (gomanga2025) pages. Same shape as
 *      Yen Press, which is why we reuse the same MONTHS table.
 *   2. "2022/07/26" — older (gomanga2017/2020) pages. YYYY/MM/DD with
 *      numeric slashes. Single-digit months and days are tolerated.
 *
 * Dash-separated ISO dates are deliberately NOT accepted — Seven Seas
 * never emits them, and accepting them would mask upstream bugs where
 * already-parsed ISO dates get round-tripped back through here.
 *
 * Returns undefined on any input that doesn't match either format.
 */
export function parseSevenSeasDate(dateStr: string): string | undefined {
  const normalized = dateStr.replace(/\s+/g, " ").trim();

  // Slash format: 2022/07/26 or 2013/1/5
  const slashMatch = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const [, year, month, day] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00Z`;
  }

  // Month-name format: November 14, 2023 / Nov 14, 2023
  const wordMatch = normalized.match(/^([A-Za-z]+)\s+(\d{1,2})\s*,\s*(\d{4})$/);
  if (wordMatch) {
    const month = MONTHS[wordMatch[1].toLowerCase()];
    if (!month) return undefined;
    const day = wordMatch[2].padStart(2, "0");
    return `${wordMatch[3]}-${month}-${day}T00:00:00Z`;
  }

  return undefined;
}

/**
 * Extract the sub-imprint label from a Seven Seas product page.
 *
 * Sub-imprints (Ghost Ship, Steamship, Airship, Danmei, etc.) render as
 * a sibling to the age-rating badge with the class `age-rating` and an
 * id of the form `<XX>-block` — e.g., `<div id="GS-block"
 * class="age-rating"><a href="...">Ghost Ship</a></div>`. The age-rating
 * badge itself also has `class="age-rating"` but uses ids like
 * `"teen"`, `"olderteen15"`, so we filter by id suffix to distinguish.
 *
 * Returns undefined for pages that only contain the rating badge (main
 * Seven Seas line with no sub-imprint).
 */
function extractImprint(
  doc: ReturnType<typeof shisho.html.parse>,
): string | undefined {
  const ratings = shisho.html.querySelectorAll(doc, "div.age-rating");
  for (const div of ratings) {
    const id = div.attributes.id ?? "";
    if (!id.endsWith("-block")) continue;
    const text = div.text.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return undefined;
}

/**
 * Extract the per-volume cover URL from a Seven Seas product page.
 *
 * Seven Seas renders the cover as `<div id="volume-cover"><img src="...">`
 * with an absolute URL in the `src` attribute — no lazy-load shenanigans
 * to unwind. We use the attribute directly when it starts with "http".
 */
function extractCover(
  doc: ReturnType<typeof shisho.html.parse>,
): string | undefined {
  const img = shisho.html.querySelector(doc, "div#volume-cover img");
  const src = img?.attributes.src;
  return src && src.startsWith("http") ? src : undefined;
}

/**
 * Parse a Seven Seas product page into VolumeMetadata. Always returns
 * at least `{ url }` — fields that cannot be extracted are simply
 * omitted. The `| null` return type is reserved for a future error-page
 * detection path; the current implementation never returns null.
 */
export function parseProduct(
  html: string,
  url: string,
): VolumeMetadata | null {
  // Some Seven Seas responses (and the web.archive.org snapshots used for
  // test fixtures) omit the `<html>` root element entirely, which trips
  // up strict parsers. Wrap defensively so the downstream selectors always
  // see a well-formed tree.
  const wrapped = /<html[\s>]/i.test(html) ? html : `<html>${html}</html>`;
  const doc = shisho.html.parse(wrapped);
  const metadata: VolumeMetadata = { url };

  const coverUrl = extractCover(doc);
  if (coverUrl) metadata.coverUrl = coverUrl;

  const imprint = extractImprint(doc);
  if (imprint) metadata.imprint = imprint;

  return metadata;
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
