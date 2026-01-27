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
 * Convert a string to title case.
 */
export function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Extract the ID portion from an Open Library key.
 * E.g., "/works/OL123W" -> "OL123W", "/books/OL456M" -> "OL456M"
 */
export function extractOLId(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1];
}

/**
 * Parse Open Library date formats to ISO 8601.
 * Handles: "1954", "June 1954", "Jun 15, 1954", "June 15, 1954"
 * Returns undefined if unparseable.
 */
export function parseOLDate(dateStr: string): string | undefined {
  if (!dateStr) return undefined;

  const trimmed = dateStr.trim();

  // Year only: "1954"
  if (/^\d{4}$/.test(trimmed)) {
    return `${trimmed}-01-01`;
  }

  // Month Year: "June 1954" or "Jun 1954"
  const monthYearMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const month = parseMonth(monthYearMatch[1]);
    if (month) {
      return `${monthYearMatch[2]}-${month}-01`;
    }
  }

  // Full date: "Jun 15, 1954" or "June 15, 1954"
  const fullDateMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (fullDateMatch) {
    const month = parseMonth(fullDateMatch[1]);
    if (month) {
      const day = fullDateMatch[2].padStart(2, "0");
      return `${fullDateMatch[3]}-${month}-${day}`;
    }
  }

  // ISO-like: "1954-06-15"
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}

/**
 * Parse month name to 2-digit string.
 */
function parseMonth(monthStr: string): string | undefined {
  const months: Record<string, string> = {
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
  return months[monthStr.toLowerCase()];
}

/**
 * Parse series number from a series string.
 * E.g., "Book 2" -> 2, "Vol. 3" -> 3, "#5" -> 5
 */
export function parseSeriesNumber(seriesStr: string): number | undefined {
  // Look for patterns like "Book 2", "Vol. 3", "#5", "Part 1"
  const match = seriesStr.match(
    /(?:book|vol\.?|volume|part|#|no\.?|number)\s*(\d+)/i,
  );
  if (match) {
    return parseInt(match[1], 10);
  }

  // Look for trailing number: "Series Name 2"
  const trailingMatch = seriesStr.match(/\s(\d+)$/);
  if (trailingMatch) {
    return parseInt(trailingMatch[1], 10);
  }

  return undefined;
}

/**
 * Normalize description from Open Library format.
 * Can be string or { type: "/type/text", value: "..." }
 */
export function normalizeDescription(
  desc: string | { type?: string; value: string } | undefined,
): string | undefined {
  if (!desc) return undefined;
  if (typeof desc === "string") return desc;
  if (typeof desc === "object" && "value" in desc) return desc.value;
  return undefined;
}
