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
  //    e.g. "Foo v01 (2023) (Digital) (1r0n)" -> "Foo v01"
  while (true) {
    const stripped = working.replace(/\s*\([^()]*\)\s*$/, "");
    if (stripped === working) break;
    working = stripped;
  }

  // 3. Clean up trailing whitespace, dashes, and hyphens.
  working = working.replace(/[\s\-–—]+$/, "").trim();

  return { seriesTitle: working };
}
