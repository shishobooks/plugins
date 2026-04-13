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
 * Extract the `content` attribute of a meta tag identified by its
 * `property` value (e.g., "og:title"). Returns undefined if the tag is
 * missing or has no content.
 */
function metaContent(
  doc: ReturnType<typeof shisho.html.parse>,
  property: string,
): string | undefined {
  const el = shisho.html.querySelector(doc, `meta[property="${property}"]`);
  return el?.attributes.content;
}

/**
 * Parse a product HTML page into VolumeMetadata.
 *
 * Meta tags (og:title, og:description, og:image) are read via shisho.html's
 * CSS selector support. The product details block (ISBN-13, Release,
 * Imprint) uses `<strong>Label</strong>Value` pairs where the value is a
 * sibling text node — CSS selectors alone can't hop from a label element
 * to its following text, so those fields are still extracted by regex.
 * Page count ("Length") is intentionally not extracted — it is a
 * file-parser-owned field.
 */
export function parseProduct(html: string, url: string): VolumeMetadata {
  const metadata: VolumeMetadata = { url };
  const doc = shisho.html.parse(html);

  // Description: og:description (may contain HTML entities like &quot;).
  const ogDesc = metaContent(doc, "og:description");
  if (ogDesc) metadata.description = stripHTML(ogDesc);

  // Cover image: og:image. Viz hosts product covers on a CloudFront CDN
  // whose filename is the ISBN-10 (e.g.,
  // https://dw9to29mmj727.cloudfront.net/products/1569319014.jpg).
  const ogImage = metaContent(doc, "og:image");
  if (ogImage) metadata.coverUrl = ogImage;

  // The remaining fields live as `<strong>Label</strong>\s*Value` pairs
  // where Value is a text or anchor sibling. Stick with regex for these.
  const isbn13 = matchLabelValue(html, "ISBN-13", /([\d-]{13,17})/);
  if (isbn13) metadata.isbn13 = isbn13.replace(/-/g, "");

  const releaseDate = matchLabelValue(
    html,
    "Release",
    /([A-Za-z]+\s+\d{1,2},\s*\d{4})/,
  );
  if (releaseDate) {
    const parsed = parseVizDate(releaseDate);
    if (parsed) metadata.releaseDate = parsed;
  }

  // Imprint: anchor text after <strong>Imprint</strong>.
  const imprintMatch = html.match(
    /<strong>Imprint<\/strong>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i,
  );
  if (imprintMatch) metadata.imprint = imprintMatch[1].trim();

  return metadata;
}

/**
 * Match a `<strong>Label</strong>\s*<valueRegex>` pair in raw HTML and
 * return the value. The valueRegex should have exactly one capture group.
 */
function matchLabelValue(
  html: string,
  label: string,
  valueRegex: RegExp,
): string | undefined {
  const pattern = new RegExp(
    `<strong>${label}<\\/strong>\\s*${valueRegex.source}`,
    "i",
  );
  const m = html.match(pattern);
  return m ? m[1].trim() : undefined;
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
