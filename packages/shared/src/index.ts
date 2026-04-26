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

/**
 * Strip all formatting from an ISBN — dashes, spaces, other punctuation —
 * uppercase any trailing `x` checksum, and verify the check digit. Returns
 * `""` for input that isn't a structurally-valid ISBN-10 or ISBN-13 with a
 * correct checksum. Rejecting bad-checksum numbers here keeps callers
 * (e.g. query-identifier routing) from mis-classifying arbitrary digit
 * strings as ISBNs.
 */
export function normalizeIsbn(isbn: string): string {
  const stripped = isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (/^\d{13}$/.test(stripped) && isValidIsbn13Checksum(stripped)) {
    return stripped;
  }
  if (/^\d{9}[\dX]$/.test(stripped) && isValidIsbn10Checksum(stripped)) {
    return stripped;
  }
  return "";
}

function isValidIsbn13Checksum(isbn: string): boolean {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(isbn[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(isbn[12], 10);
}

function isValidIsbn10Checksum(isbn: string): boolean {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(isbn[i], 10) * (10 - i);
  }
  const last = isbn[9];
  const check = last === "X" ? 10 : parseInt(last, 10);
  return (sum + check) % 11 === 0;
}

/**
 * Convert ISBN-10 → ISBN-13 (978 prefix, recalculated checksum).
 * Returns `""` if the input isn't a valid-shaped ISBN-10.
 */
export function isbn10To13(isbn10: string): string {
  const normalized = normalizeIsbn(isbn10);
  if (normalized.length !== 10) return "";
  const body = "978" + normalized.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(body[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const checksum = (10 - (sum % 10)) % 10;
  return body + checksum;
}

/**
 * Compare two ISBNs for equivalence, tolerant of dashes/spaces and the
 * ISBN-10 ↔ ISBN-13 split (a 10-digit ISBN and its 978-prefixed 13-digit
 * form are treated as equal). Returns false if either input isn't a
 * well-formed ISBN.
 */
export function isbnsMatch(a: string, b: string): boolean {
  const na = normalizeIsbn(a);
  const nb = normalizeIsbn(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length === 10 && nb.length === 13) return isbn10To13(na) === nb;
  if (na.length === 13 && nb.length === 10) return na === isbn10To13(nb);
  return false;
}

/**
 * Strip HTML tags and decode common entities, preserving paragraph
 * structure. `<script>`/`<style>` blocks are removed entirely (tags
 * and body). `<br>` and `</li>` become single newlines; `<hr>` and
 * block-level closers (`</p>`, `</div>`, `</h1-6>`, `</ul>`, `</ol>`,
 * `</blockquote>`, `</section>`, `</article>`, `</aside>`, `</header>`,
 * `</footer>`, `</figure>`) become double newlines. Trailing whitespace
 * before newlines is dropped and runs of 3+ newlines collapse to `\n\n`.
 */
export function stripHTML(html: string): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(
      /<\/(p|div|h[1-6]|ul|ol|blockquote|section|article|aside|header|footer|figure)>/gi,
      "\n\n",
    )
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
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
