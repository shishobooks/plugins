import type { PublisherScraper, VolumeMetadata } from "./types";

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
