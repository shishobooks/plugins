import { parseMonth } from "@shisho-plugins/shared";

export {
  levenshteinDistance,
  normalizeForComparison,
} from "@shisho-plugins/shared";

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
    return `${trimmed}-01-01T00:00:00Z`;
  }

  // Month Year: "June 1954" or "Jun 1954"
  const monthYearMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const month = parseMonth(monthYearMatch[1]);
    if (month) {
      return `${monthYearMatch[2]}-${month}-01T00:00:00Z`;
    }
  }

  // Full date: "Jun 15, 1954" or "June 15, 1954"
  const fullDateMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (fullDateMatch) {
    const month = parseMonth(fullDateMatch[1]);
    if (month) {
      const day = fullDateMatch[2].padStart(2, "0");
      return `${fullDateMatch[3]}-${month}-${day}T00:00:00Z`;
    }
  }

  // ISO-like: "1954-06-15"
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00Z`;
  }

  return undefined;
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
