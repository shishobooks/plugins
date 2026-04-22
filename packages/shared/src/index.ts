/**
 * Calculate Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Normalize a string for comparison: lowercase, remove punctuation, collapse whitespace.
 */
export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Drop anything after a subtitle delimiter (`:`, en-dash, em-dash).
 * Lets us compare a base title like "Yesteryear" against a full title like
 * "Yesteryear: A GMA Book Club Pick" without the subtitle inflating the
 * edit distance. Use on both sides of a title comparison.
 */
export function stripSubtitle(text: string): string {
  const idx = text.search(/[:–—]/);
  return idx >= 0 ? text.slice(0, idx).trim() : text;
}

/**
 * Split a title on its first colon into base title and subtitle.
 * Returns the original title and no subtitle if there is no colon or
 * either side would be empty after trimming. Only splits on `:` — not
 * dashes — since a colon is the conventional subtitle delimiter on
 * book covers and catalog data.
 */
export function splitTitleSubtitle(title: string): {
  title: string;
  subtitle?: string;
} {
  const idx = title.indexOf(":");
  if (idx < 0) return { title };
  const base = title.slice(0, idx).trim();
  const sub = title.slice(idx + 1).trim();
  if (!base || !sub) return { title };
  return { title: base, subtitle: sub };
}

/**
 * Confidence (0-1) that `title` matches `query`, based on Levenshtein
 * distance over normalized strings. Compares both the full titles and
 * subtitle-stripped versions, returning the higher score so a query like
 * "Yesteryear" still scores 1.0 against "Yesteryear: A GMA Book Club Pick".
 * Accepts raw unnormalized text — normalization is applied internally.
 */
export function titleMatchConfidence(query: string, title: string): number {
  return Math.max(
    rawTitleConfidence(query, title),
    rawTitleConfidence(stripSubtitle(query), stripSubtitle(title)),
  );
}

function rawTitleConfidence(query: string, title: string): number {
  const nq = normalizeForComparison(query);
  const nt = normalizeForComparison(title);
  if (nq.length === 0 || nt.length === 0) return 0;
  const distance = levenshteinDistance(nq, nt);
  const maxLen = Math.max(nq.length, nt.length);
  return 1 - distance / maxLen;
}

/**
 * Parse month name to 2-digit string.
 * Supports full names (January) and abbreviations (Jan, Sep, Sept).
 */
const MONTHS: Record<string, string> = {
  january: "01",
  jan: "01",
  february: "02",
  feb: "02",
  march: "03",
  mar: "03",
  april: "04",
  apr: "04",
  may: "05",
  june: "06",
  jun: "06",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sep: "09",
  sept: "09",
  october: "10",
  oct: "10",
  november: "11",
  nov: "11",
  december: "12",
  dec: "12",
};

export function parseMonth(monthStr: string): string | undefined {
  return MONTHS[monthStr.toLowerCase()];
}

/**
 * Strip HTML tags and decode common entities, preserving line breaks.
 * Converts <br> to newlines and </p><p> to double newlines before
 * stripping remaining tags.
 */
/**
 * Slugify a title for use in URL paths: lowercase, drop apostrophes
 * (both ASCII `'` and Unicode right-single-quote `'` / U+2019), then
 * collapse runs of non-alphanumeric characters to single hyphens and
 * trim leading/trailing hyphens.
 *
 * Used by publisher scrapers that construct product-page URLs directly
 * from a series title (Kodansha, Seven Seas). Matches the de-facto
 * convention those sites use for their slugs — e.g.,
 * "Rozen Maiden Collector's Edition" → "rozen-maiden-collectors-edition"
 * (apostrophe dropped, not hyphenated). This differs from Yen Press,
 * which preserves apostrophes as hyphens; that scraper implements its
 * own slug helper.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stripHTML(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}
