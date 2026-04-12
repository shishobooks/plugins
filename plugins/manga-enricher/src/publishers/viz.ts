import type { PublisherScraper, VolumeMetadata } from "./types";
import { stripHTML } from "@shisho-plugins/shared";

const USER_AGENT =
  "ShishoPlugin/0.1.0 (manga-enricher; github.com/shishobooks/plugins)";

const SEARCH_URL = "https://www.viz.com/search";
const BASE_URL = "https://www.viz.com";

function fetchHtml(url: string): string | null {
  shisho.log.debug(`Viz: fetching ${url}`);
  const response = shisho.http.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response || !response.ok) {
    shisho.log.warn(`Viz: HTTP ${response?.status ?? "no response"} ${url}`);
    return null;
  }
  try {
    return response.text();
  } catch {
    shisho.log.warn(`Viz: failed to read response body for ${url}`);
    return null;
  }
}

/**
 * Build a search URL for the given query. Appends the edition variant if
 * provided so that editions (e.g., "Omnibus Edition") are treated as
 * distinct series by Viz's search.
 */
function buildSearchUrl(seriesTitle: string, edition?: string): string {
  const q = edition ? `${seriesTitle} ${edition}` : seriesTitle;
  const qs = shisho.url.searchParams({ search: q, category: "Manga" });
  return `${SEARCH_URL}?${qs}`;
}

/**
 * Scan the search HTML and pick the product path that corresponds to the
 * requested volume number. Viz product paths look like
 * `/manga-books/manga/<slug>-volume-<N>-0/product/<id>` — the slug always
 * ends with `volume-<N>-0` for single volumes. For editions, the slug
 * includes the edition words (e.g., `one-piece-omnibus-edition-volume-5-0`).
 */
export function pickProductPath(
  searchHtml: string,
  volumeNumber: number,
): string | null {
  const linkRegex =
    /href="(\/manga-books\/manga\/[^"]*?volume-(\d+)-0\/product\/\d+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(searchHtml)) !== null) {
    const [, path, num] = match;
    if (parseInt(num, 10) === volumeNumber) {
      return path;
    }
  }
  return null;
}

/**
 * Extract a single field from raw HTML using a regex that captures one
 * group. Returns undefined if the pattern doesn't match.
 */
function matchOne(html: string, pattern: RegExp): string | undefined {
  const m = html.match(pattern);
  return m ? m[1].trim() : undefined;
}

/**
 * Parse a product HTML page into VolumeMetadata. The regex patterns here
 * were derived from inspecting real Viz product page fixtures and match the
 * actual HTML structure at time of implementation.
 *
 * Actual HTML patterns observed:
 *   - og:title:    <meta property="og:title" content="VIZ: Read a Free Preview of One Piece, Vol. 1">
 *   - og:desc:     <meta property="og:description" content="As a child...">  (HTML entities encoded)
 *   - ISBN-13:     <strong>ISBN-13</strong> 978-1-56931-901-7
 *   - Release:     <strong>Release</strong> September  2, 2003
 *   - Length:      <strong>Length</strong> 216 pages
 *   - Imprint:     <strong>Imprint</strong>\n...<a ...>SHONEN JUMP</a>
 *   - Age Rating:  <strong>Age Rating</strong>\n...<a ...></a>&nbsp;\n            Teen
 */
export function parseProduct(html: string, url: string): VolumeMetadata {
  const metadata: VolumeMetadata = { url };

  // Title: og:title meta tag, stripping the "VIZ: Read a Free Preview of "
  // prefix that Viz prepends to the product title.
  const ogTitle = matchOne(
    html,
    /<meta property="og:title"\s+content="([^"]+)"/i,
  );
  if (ogTitle) {
    metadata.title = ogTitle
      .replace(/^VIZ:\s*Read\s+a\s+Free\s+Preview\s+of\s+/i, "")
      .trim();
  }

  // Description: og:description meta tag (may contain HTML entities like &quot;).
  const ogDesc = matchOne(
    html,
    /<meta property="og:description"\s+content="([^"]+)"/i,
  );
  if (ogDesc) metadata.description = stripHTML(ogDesc);

  // ISBN-13: text immediately after <strong>ISBN-13</strong> on the same line.
  // Actual HTML: <strong>ISBN-13</strong> 978-1-56931-901-7
  const isbn13 = matchOne(html, /<strong>ISBN-13<\/strong>\s*([\d-]{13,17})/i);
  if (isbn13) metadata.isbn13 = isbn13.replace(/-/g, "");

  // Release date: text immediately after <strong>Release</strong> on the same line.
  // Actual HTML: <strong>Release</strong> September  2, 2003
  // Note: Viz sometimes has a double space before single-digit days.
  const releaseDate = matchOne(
    html,
    /<strong>Release<\/strong>\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i,
  );
  if (releaseDate) {
    const parsed = parseVizDate(releaseDate);
    if (parsed) metadata.releaseDate = parsed;
  }

  // Page count: text after <strong>Length</strong>.
  // Actual HTML: <strong>Length</strong> 216 pages
  const pages = matchOne(html, /<strong>Length<\/strong>\s+(\d+)\s+pages/i);
  if (pages) metadata.pageCount = parseInt(pages, 10);

  // Imprint: anchor text after <strong>Imprint</strong>.
  // Actual HTML: <strong>Imprint</strong>\n  <a href="...">SHONEN JUMP</a>
  const imprint = matchOne(
    html,
    /<strong>Imprint<\/strong>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i,
  );
  if (imprint) metadata.imprint = imprint;

  return metadata;
}

/**
 * Parse a Viz date string like "September 5, 2023" into ISO 8601.
 * Tolerates extra whitespace (Viz sometimes uses double spaces).
 */
function parseVizDate(dateStr: string): string | undefined {
  const months: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };
  // Collapse any multiple whitespace between tokens before matching.
  const normalized = dateStr.replace(/\s+/g, " ").trim();
  const m = normalized.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return undefined;
  const month = months[m[1].toLowerCase()];
  if (!month) return undefined;
  const day = m[2].padStart(2, "0");
  return `${m[3]}-${month}-${day}T00:00:00Z`;
}

export const vizScraper: PublisherScraper = {
  name: "Viz Media",

  matchPublisher(publisherName: string): boolean {
    return /\bviz\b/i.test(publisherName);
  },

  searchVolume(
    seriesTitle: string,
    volumeNumber: number,
    edition?: string,
  ): VolumeMetadata | null {
    const searchUrl = buildSearchUrl(seriesTitle, edition);
    const searchHtml = fetchHtml(searchUrl);
    if (!searchHtml) return null;

    const productPath = pickProductPath(searchHtml, volumeNumber);
    if (!productPath) {
      shisho.log.debug(
        `Viz: no volume-${volumeNumber} product link found for "${seriesTitle}"`,
      );
      return null;
    }

    const productUrl = `${BASE_URL}${productPath}`;
    const productHtml = fetchHtml(productUrl);
    if (!productHtml) return null;

    return parseProduct(productHtml, productUrl);
  },
};
