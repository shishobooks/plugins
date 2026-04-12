import {
  MARKETPLACE_TLDS,
  type AudibleProduct,
  type AudnexusBook,
} from "./types";
import type { ParsedMetadata } from "@shisho/plugin-sdk";

/**
 * Strip HTML tags and decode common HTML entities.
 */
export function stripHTML(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Parse a date string to ISO 8601 format.
 * Handles "YYYY-MM-DD" and "YYYY" formats.
 */
function toISODate(dateStr: string): string | undefined {
  if (!dateStr) return undefined;
  const trimmed = dateStr.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00Z`;
  }

  // YYYY
  if (/^\d{4}$/.test(trimmed)) {
    return `${trimmed}-01-01T00:00:00Z`;
  }

  return undefined;
}

/**
 * Build product URL for a given marketplace.
 */
function productUrl(asin: string, marketplace: string): string {
  const tld = MARKETPLACE_TLDS[marketplace] ?? "com";
  return `https://www.audible.${tld}/pd/${asin}`;
}

/**
 * Extract leaf genre names from Audible category_ladders.
 * Each ladder is a path from root to leaf; we take the last element.
 */
function extractGenres(
  ladders: AudibleProduct["category_ladders"],
): string[] | undefined {
  if (!ladders || ladders.length === 0) return undefined;

  const genres = ladders
    .map((l) => l.ladder[l.ladder.length - 1]?.name)
    .filter((name): name is string => !!name);

  return genres.length > 0 ? genres : undefined;
}

/**
 * Parse a series sequence string to a number.
 * Handles integers ("1") and fractional ("2.5").
 */
function parseSequence(seq: string | undefined): number | undefined {
  if (!seq) return undefined;
  const n = parseFloat(seq);
  return isNaN(n) ? undefined : n;
}

/**
 * Map Audible/Audnexus language names to BCP 47 tags.
 * Audible returns lowercase English language names (e.g., "english", "german").
 */
const LANGUAGE_MAP: Record<string, string> = {
  english: "en",
  german: "de",
  french: "fr",
  spanish: "es",
  italian: "it",
  portuguese: "pt",
  dutch: "nl",
  japanese: "ja",
  chinese: "zh",
  korean: "ko",
  russian: "ru",
  arabic: "ar",
  hindi: "hi",
  swedish: "sv",
  norwegian: "no",
  danish: "da",
  finnish: "fi",
  polish: "pl",
  turkish: "tr",
  catalan: "ca",
  czech: "cs",
  greek: "el",
  hebrew: "he",
  hungarian: "hu",
  romanian: "ro",
  thai: "th",
  ukrainian: "uk",
  vietnamese: "vi",
};

/**
 * Parse a language value to a BCP 47 tag.
 * Accepts either a language name ("english") or an existing BCP 47 tag ("en", "en-US").
 */
export function parseLanguage(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const trimmed = lang.trim();
  if (!trimmed) return undefined;

  // Already a BCP 47 tag: 2-3 letter primary tag, optional subtags
  if (/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(trimmed)) {
    return trimmed;
  }

  return LANGUAGE_MAP[trimmed.toLowerCase()];
}

/**
 * Parse Audible/Audnexus format_type to an abridged boolean.
 * "unabridged" -> false, "abridged" -> true, otherwise undefined.
 */
export function parseAbridged(
  formatType: string | undefined,
): boolean | undefined {
  if (!formatType) return undefined;
  const normalized = formatType.trim().toLowerCase();
  if (normalized === "abridged") return true;
  if (normalized === "unabridged") return false;
  return undefined;
}

/**
 * Transform an Audible catalog API product to ParsedMetadata.
 */
export function audibleToMetadata(
  product: AudibleProduct,
  marketplace: string,
): ParsedMetadata {
  const metadata: ParsedMetadata = {};

  metadata.title = product.title;

  if (product.subtitle) {
    metadata.subtitle = product.subtitle;
  }

  if (product.authors && product.authors.length > 0) {
    metadata.authors = product.authors.map((a) => ({ name: a.name }));
  }

  if (product.narrators && product.narrators.length > 0) {
    metadata.narrators = product.narrators.map((n) => n.name);
  }

  if (product.publisher_name) {
    metadata.publisher = product.publisher_name;
  }

  if (product.publisher_summary) {
    metadata.description = stripHTML(product.publisher_summary);
  }

  const dateStr = product.release_date ?? product.issue_date;
  if (dateStr) {
    const isoDate = toISODate(dateStr);
    if (isoDate) {
      metadata.releaseDate = isoDate;
    }
  }

  if (product.series && product.series.length > 0) {
    const primary = product.series[0];
    metadata.series = primary.title;
    const num = parseSequence(primary.sequence);
    if (num !== undefined) {
      metadata.seriesNumber = num;
    }
  }

  const coverUrl =
    product.product_images?.["1024"] ?? product.product_images?.["500"];
  if (coverUrl) {
    metadata.coverUrl = coverUrl;
  }

  metadata.genres = extractGenres(product.category_ladders);

  const language = parseLanguage(product.language);
  if (language) {
    metadata.language = language;
  }

  const abridged = parseAbridged(product.format_type);
  if (abridged !== undefined) {
    metadata.abridged = abridged;
  }

  metadata.url = productUrl(product.asin, marketplace);
  metadata.identifiers = [{ type: "asin", value: product.asin }];

  return metadata;
}

/**
 * Transform an Audnexus book response to ParsedMetadata.
 */
export function audnexusToMetadata(
  book: AudnexusBook,
  marketplace: string,
): ParsedMetadata {
  const metadata: ParsedMetadata = {};

  metadata.title = book.title;

  if (book.subtitle) {
    metadata.subtitle = book.subtitle;
  }

  if (book.authors && book.authors.length > 0) {
    metadata.authors = book.authors.map((a) => ({ name: a.name }));
  }

  if (book.narrators && book.narrators.length > 0) {
    metadata.narrators = book.narrators.map((n) => n.name);
  }

  if (book.publisherName) {
    metadata.publisher = book.publisherName;
  }

  if (book.summary) {
    metadata.description = stripHTML(book.summary);
  }

  if (book.releaseDate) {
    const isoDate = toISODate(book.releaseDate);
    if (isoDate) {
      metadata.releaseDate = isoDate;
    }
  }

  if (book.seriesPrimary) {
    metadata.series = book.seriesPrimary.name;
    const num = parseSequence(book.seriesPrimary.position);
    if (num !== undefined) {
      metadata.seriesNumber = num;
    }
  }

  if (book.image) {
    metadata.coverUrl = book.image;
  }

  if (book.genres && book.genres.length > 0) {
    const genres = book.genres
      .filter((g) => g.type === "genre")
      .map((g) => g.name);
    const tags = book.genres.filter((g) => g.type === "tag").map((g) => g.name);

    if (genres.length > 0) metadata.genres = genres;
    if (tags.length > 0) metadata.tags = tags;
  }

  const language = parseLanguage(book.language);
  if (language) {
    metadata.language = language;
  }

  const abridged = parseAbridged(book.formatType);
  if (abridged !== undefined) {
    metadata.abridged = abridged;
  }

  metadata.url = productUrl(book.asin, marketplace);
  metadata.identifiers = [{ type: "asin", value: book.asin }];

  return metadata;
}
