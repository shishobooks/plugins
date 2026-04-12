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
    /\s*[Vv](\d+)\b\s*$/, // "v01", "v1"
    /\s*[Vv]ol(?:ume)?\.?\s*(\d+)\b\s*$/, // "Vol. 03", "Volume 001"
    /\s*#(\d+)\b\s*$/, // "#001"
    /\s(\d{2,3})$/, // trailing 2-3 digit number
  ];

  for (const pattern of volumePatterns) {
    const match = working.match(pattern);
    if (match) {
      volumeNumber = parseInt(match[1], 10);
      working = working.slice(0, match.index).trimEnd();
      break;
    }
  }

  // 4. Clean up trailing whitespace, dashes, and hyphens.
  working = working.replace(/[\s\-–—]+$/, "").trim();

  return {
    seriesTitle: working,
    volumeNumber,
  };
}
