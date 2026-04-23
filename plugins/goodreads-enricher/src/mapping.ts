import type { GRLookupResult } from "./types";
import { parseMonth, stripHTML } from "@shisho-plugins/shared";
import type {
  ParsedAuthor,
  ParsedIdentifier,
  ParsedMetadata,
} from "@shisho/plugin-sdk";

const MAX_GENRES = 3;

/**
 * Transform Goodreads lookup result to Shisho ParsedMetadata.
 */
export function toMetadata(result: GRLookupResult): ParsedMetadata {
  const { autocomplete, pageData } = result;
  const metadata: ParsedMetadata = {};

  // Title - prefer autocomplete bare title (no series suffix), fall back to JSON-LD name
  const rawTitle =
    autocomplete?.bookTitleBare ?? pageData.schemaOrg?.name ?? undefined;
  if (rawTitle) {
    metadata.title = cleanTitle(rawTitle);
  }

  // Authors - prefer JSON-LD authors (more complete), fall back to autocomplete
  if (pageData.schemaOrg?.author && pageData.schemaOrg.author.length > 0) {
    metadata.authors = pageData.schemaOrg.author.map(
      (a): ParsedAuthor => ({ name: a.name }),
    );
  } else if (autocomplete) {
    metadata.authors = [{ name: autocomplete.author.name }];
  }

  // Description - prefer page description, fall back to autocomplete
  if (pageData.description) {
    metadata.description = pageData.description;
  } else if (autocomplete?.description?.html) {
    metadata.description = stripHTML(autocomplete.description.html);
  }

  // Publisher
  if (pageData.publisher) {
    metadata.publisher = pageData.publisher;
  }

  // Release date
  if (pageData.publishDate) {
    const isoDate = parseGRDate(pageData.publishDate);
    if (isoDate) {
      metadata.releaseDate = isoDate;
    }
  }

  // Series
  if (pageData.series) {
    metadata.series = pageData.series;
    if (pageData.seriesNumber !== null) {
      metadata.seriesNumber = pageData.seriesNumber;
    }
  }

  // Genres and tags - first few are genres, rest are tags
  if (pageData.genres.length > 0) {
    metadata.genres = pageData.genres.slice(0, MAX_GENRES);
    if (pageData.genres.length > MAX_GENRES) {
      metadata.tags = pageData.genres.slice(MAX_GENRES);
    }
  }

  // Identifiers
  const identifiers = collectIdentifiers(result);
  if (identifiers.length > 0) {
    metadata.identifiers = identifiers;
  }

  // Cover image — pass URL for server to download at apply time.
  // Both Apollo and autocomplete URLs may contain size suffixes (_SY75_, _SX50_); always strip.
  const rawCoverUrl =
    pageData.schemaOrg?.image ?? autocomplete?.imageUrl ?? undefined;
  if (rawCoverUrl) {
    metadata.coverUrl = stripImageSuffix(rawCoverUrl);
  }

  return metadata;
}

/**
 * Clean the title by removing series suffix if present.
 * E.g., "The Name of the Wind (The Kingkiller Chronicle, #1)" -> "The Name of the Wind"
 */
export function cleanTitle(title: string): string {
  const match = title.match(/^(.+?)\s*\([^)]*#[\d.]+\)\s*$/);
  if (match) {
    return match[1].trim();
  }

  return title;
}

/**
 * Collect all identifiers from the lookup result.
 */
function collectIdentifiers(result: GRLookupResult): ParsedIdentifier[] {
  const identifiers: ParsedIdentifier[] = [];

  // Goodreads book ID
  identifiers.push({ type: "goodreads", value: result.bookId });

  // ISBN from JSON-LD
  if (result.pageData.schemaOrg?.isbn) {
    const isbn = result.pageData.schemaOrg.isbn;
    if (isbn.length === 13) {
      identifiers.push({ type: "isbn_13", value: isbn });
    } else if (isbn.length === 10) {
      identifiers.push({ type: "isbn_10", value: isbn });
    }
  }

  // ASIN for Kindle / Amazon editions
  if (result.pageData.schemaOrg?.asin) {
    identifiers.push({ type: "asin", value: result.pageData.schemaOrg.asin });
  }

  return identifiers;
}

/**
 * Parse Goodreads date formats to ISO 8601.
 * Handles: "September 21, 1937", "March 27, 2007", "September 1937", "1937"
 */
export function parseGRDate(dateStr: string): string | undefined {
  if (!dateStr) return undefined;
  const trimmed = dateStr.trim();

  // Year only: "1937"
  if (/^\d{4}$/.test(trimmed)) {
    return `${trimmed}-01-01T00:00:00Z`;
  }

  // Full date: "September 21, 1937" or "March 27 2007"
  const fullMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (fullMatch) {
    const month = parseMonth(fullMatch[1]);
    if (month) {
      const day = fullMatch[2].padStart(2, "0");
      return `${fullMatch[3]}-${month}-${day}T00:00:00Z`;
    }
  }

  // Month Year: "September 1937"
  const monthYearMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const month = parseMonth(monthYearMatch[1]);
    if (month) {
      return `${monthYearMatch[2]}-${month}-01T00:00:00Z`;
    }
  }

  return undefined;
}

/**
 * Strip Goodreads image size suffixes (e.g., _SY75_, _SX50_) to get full-size URL.
 */
export function stripImageSuffix(url: string): string {
  return url.replace(/\._S[XY]\d+_\./, ".");
}
