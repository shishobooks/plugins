/**
 * Parsed result of a manga search query (typically a filename-derived string).
 */
export interface ParsedQuery {
  /** The series title with noise stripped. */
  seriesTitle: string;
  /** The volume number if one could be extracted. */
  volumeNumber?: number;
  /** The edition variant if one was detected (e.g., "Collector's Edition"). */
  edition?: string;
}

/**
 * Known edition variant keywords. Order matters: more specific multi-word
 * phrases must come before their shorter prefixes (e.g., "Omnibus Edition"
 * before "Omnibus", "Deluxe Edition" before "Deluxe").
 */
const EDITION_VARIANTS: readonly string[] = [
  "Collector's Edition",
  "Omnibus Edition",
  "Omnibus",
  "Box Set",
  "Deluxe Edition",
  "Deluxe",
  "3-in-1 Edition",
  "2-in-1 Edition",
  "Master Edition",
  "Perfect Edition",
  "Complete Edition",
  "Fullmetal Edition",
  "Digital Colored Comics",
  "Full Color Edition",
];

/**
 * Escape a string for use inside a regular expression.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a search query into its component parts.
 *
 * The query is typically derived from a filename by Shisho's scan pipeline.
 * We don't know exactly how clean or messy it will be, so the parser is
 * defensive: it handles already-clean titles and raw filename-like strings
 * uniformly.
 */
export function parseQuery(query: string): ParsedQuery {
  if (!query) return { seriesTitle: "" };

  let working = query;

  // 1. Strip a .cbz/.cbr extension if present.
  working = working.replace(/\.(cbz|cbr)$/i, "");

  // 2. Strip trailing parenthesized groups, repeatedly, from right to left.
  while (true) {
    const stripped = working.replace(/\s*\([^()]*\)\s*$/, "");
    if (stripped === working) break;
    working = stripped;
  }

  // 3. Extract a volume number. Try explicit markers first, then a bare
  //    trailing number as a last resort (restricted to 2-3 digits to avoid
  //    matching years).
  let volumeNumber: number | undefined;
  const volumePatterns: RegExp[] = [
    /\s*[Vv](\d+)\b\s*$/,
    /\s*[Vv]ol(?:ume)?\.?\s*(\d+)\b\s*$/,
    /\s*#(\d+)\b\s*$/,
    /\s(\d{2,3})$/,
  ];
  for (const pattern of volumePatterns) {
    const match = working.match(pattern);
    if (match) {
      volumeNumber = parseInt(match[1], 10);
      working = working.slice(0, match.index).trimEnd();
      break;
    }
  }

  // 4. Detect edition variants by searching the remaining trailing portion
  //    (case-insensitive). Longer variants come first so they win.
  let edition: string | undefined;
  for (const variant of EDITION_VARIANTS) {
    const regex = new RegExp(`[\\s\\-–—]+${escapeRegExp(variant)}\\s*$`, "i");
    const match = working.match(regex);
    if (match) {
      edition = variant;
      working = working.slice(0, match.index).trimEnd();
      break;
    }
  }

  // 5. Clean up trailing whitespace, dashes, and hyphens.
  working = working.replace(/[\s\-–—]+$/, "").trim();

  return {
    seriesTitle: working,
    volumeNumber,
    edition,
  };
}
