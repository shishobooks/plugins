import type { PublisherScraper, VolumeMetadata } from "./types";
import { stripHTML } from "@shisho-plugins/shared";

/**
 * Build the URL slug for a Yen Press series page. Lowercases, replaces runs
 * of non-alphanumeric characters with a single hyphen, and trims hyphens
 * from the ends. Apostrophes are *not* dropped first — they become hyphens
 * along with spaces, so "Fruits Basket Collector's Edition" produces
 * "fruits-basket-collector-s-edition" — matching the actual Yen Press
 * URL scheme. If an edition is provided, it's appended to the series title
 * before slugifying so editions share a series page with the base title
 * only when Yen Press itself does.
 */
export function buildSlug(seriesTitle: string, edition?: string): string {
  const base = edition ? `${seriesTitle} ${edition}` : seriesTitle;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Scan the series-page HTML and pick the product path that corresponds to
 * the requested volume number. Yen Press product paths look like
 * `/titles/<ISBN>-<slug>-vol-<N>`. We can't build this path directly
 * because the ISBN segment is unknown up front, so we grep the series
 * page for matching links.
 *
 * We capture the trailing digit group and compare numerically, so
 * `vol-1` and `vol-10` are distinct regardless of document order. The
 * non-greedy `[^"]*?` before `-vol-` keeps the capture scoped to a
 * single href attribute.
 */
export function pickProductPath(
  seriesHtml: string,
  volumeNumber: number,
): string | null {
  const linkRegex = /href="(\/titles\/[^"]*?-vol-(\d+))"/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(seriesHtml)) !== null) {
    const [, path, num] = match;
    if (parseInt(num, 10) === volumeNumber) {
      return path;
    }
  }
  return null;
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
 * Parse a Yen Press date string like "Jul 24, 2018" or "September 5, 2023"
 * into ISO 8601 (with midnight UTC time component). Tolerates extra
 * whitespace between tokens. Returns undefined when input doesn't match.
 */
export function parseYenPressDate(dateStr: string): string | undefined {
  const normalized = dateStr.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^([A-Za-z]+)\s+(\d{1,2})\s*,\s*(\d{4})$/);
  if (!match) return undefined;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return undefined;
  const day = match[2].padStart(2, "0");
  return `${match[3]}-${month}-${day}T00:00:00Z`;
}

/**
 * Extract the per-volume description from a Yen Press product page.
 *
 * The description lives in `<div class="content-heading-txt"> <p
 * class="paragraph fs-16">...</p></div>`. Yen Press also has a `<meta
 * name="description">` tag but it truncates at ~200 chars; the paragraph
 * block is the authoritative full text.
 */
function extractDescription(
  doc: ReturnType<typeof shisho.html.parse>,
): string | undefined {
  const container = shisho.html.querySelector(doc, "div.content-heading-txt");
  if (!container) return undefined;
  const paragraph = shisho.html.querySelector(container, "p.paragraph");
  const raw = paragraph?.text.trim();
  return raw ? stripHTML(raw) : undefined;
}

/**
 * Extract the per-volume cover URL from a Yen Press product page.
 *
 * Yen Press renders covers with a lazy-load pattern: `<img class="b-lazy"
 * data-src="https://images.yenpress.com/imgs/<ISBN>.jpg?...">`. The URL
 * lives in `data-src`, not `src` (which is usually empty or a placeholder).
 * We prefer the first `.book-cover-img img` on the page, which is the
 * main product cover; failing that, accept the element's `src` if it's
 * an absolute http URL.
 */
function extractCover(
  doc: ReturnType<typeof shisho.html.parse>,
): string | undefined {
  const img = shisho.html.querySelector(doc, "div.book-cover-img img");
  const dataSrc = img?.attributes["data-src"];
  if (dataSrc) return dataSrc;
  const src = img?.attributes.src;
  return src && src.startsWith("http") ? src : undefined;
}

/**
 * Find the value of a labelled detail-box within a scope element.
 *
 * Yen Press renders each field as:
 *
 *     <div class="detail-box">
 *       <span class="type paragraph fs-15">ISBN</span>
 *       <p class="info">9781975353308</p>
 *     </div>
 *
 * We iterate every `.detail-box` inside the scope, check its first `span`
 * child's text against `label` (case-insensitive), and return the first
 * `p.info` child. Irregular blocks (e.g. the print-side Imprint is not
 * wrapped in `.detail-box` on the fixture) are handled at a higher level
 * — the digital-preference logic picks a block whose Imprint is wrapped
 * correctly, so this helper's scope always matches.
 *
 * Trims whitespace and collapses runs — Yen Press uses HTML indentation
 * that otherwise leaks into `.text`.
 */
function extractDetailValue(
  scope: ReturnType<typeof shisho.html.parse>,
  label: string,
): string | undefined {
  const boxes = shisho.html.querySelectorAll(scope, "div.detail-box");
  for (const box of boxes) {
    const span = box.children.find((c) => c.tag === "span");
    if (!span) continue;
    if (span.text.trim().toLowerCase() !== label.toLowerCase()) continue;
    const info = box.children.find(
      (c) => c.tag === "p" && (c.attributes.class ?? "").includes("info"),
    );
    const value = info?.text.replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Pick the preferred detail-info block from a parsed product page.
 *
 * Yen Press product pages render a "print" `.detail-info` block followed
 * by a "digital" block. The only textual separator between them is an
 * HTML comment (`<!-- Main -->` / `<!-- Digital -->`) which `shisho.html`
 * doesn't expose, so we use position: if there are two or more blocks,
 * prefer the second (digital); otherwise use whatever's there.
 *
 * Returns null when no `.detail-info` block exists — the caller then
 * omits the detail-box-derived fields rather than throwing.
 */
function pickPreferredDetailBlock(
  doc: ReturnType<typeof shisho.html.parse>,
): ReturnType<typeof shisho.html.parse> | null {
  const blocks = shisho.html.querySelectorAll(doc, "div.detail-info");
  if (blocks.length === 0) return null;
  if (blocks.length >= 2) return blocks[1];
  return blocks[0];
}

/**
 * Parse a Yen Press product page into VolumeMetadata. Returns null if the
 * page has no recognizable structure (e.g. an error page). Individual
 * fields are simply omitted when they can't be extracted.
 */
export function parseProduct(html: string, url: string): VolumeMetadata | null {
  const doc = shisho.html.parse(html);
  const metadata: VolumeMetadata = { url };

  const description = extractDescription(doc);
  if (description) metadata.description = description;

  const coverUrl = extractCover(doc);
  if (coverUrl) metadata.coverUrl = coverUrl;

  const block = pickPreferredDetailBlock(doc);
  if (block) {
    const rawIsbn = extractDetailValue(block, "ISBN");
    if (rawIsbn) {
      const cleaned = rawIsbn.replace(/-/g, "");
      if (cleaned.length === 13) metadata.isbn13 = cleaned;
      else if (cleaned.length === 10) metadata.isbn10 = cleaned;
    }

    const rawDate = extractDetailValue(block, "Release Date");
    if (rawDate) {
      const parsed = parseYenPressDate(rawDate);
      if (parsed) metadata.releaseDate = parsed;
    }

    const imprint = extractDetailValue(block, "Imprint");
    if (imprint) metadata.imprint = imprint;
  }

  return metadata;
}

export const yenpressScraper: PublisherScraper = {
  name: "Yen Press",

  matchPublisher(publisherName: string): boolean {
    return /\byen\s+press\b/i.test(publisherName);
  },

  searchVolume(
    _seriesTitle: string,
    _volumeNumber: number,
    _edition?: string,
  ): VolumeMetadata | null {
    return null;
  },
};
