import type { GRLookupResult } from "./types";
import {
  normalizeIsbn,
  normalizeWhitespace,
  parseMonth,
  stripHTML,
} from "@shisho-plugins/shared";
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
    const cleaned = cleanTitle(rawTitle);
    const { title, subtitle } = splitSubtitle(cleaned);
    metadata.title = title;
    if (subtitle) {
      metadata.subtitle = subtitle;
    }
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

  metadata.url = `https://www.goodreads.com/book/show/${result.bookId}`;

  // Collapse stray whitespace in all text fields (e.g. "Helen  Hoang" → "Helen Hoang")
  if (metadata.title) metadata.title = normalizeWhitespace(metadata.title);
  if (metadata.subtitle)
    metadata.subtitle = normalizeWhitespace(metadata.subtitle);
  if (metadata.description)
    metadata.description = normalizeWhitespace(metadata.description);
  if (metadata.publisher)
    metadata.publisher = normalizeWhitespace(metadata.publisher);
  if (metadata.series) metadata.series = normalizeWhitespace(metadata.series);
  if (metadata.authors) {
    metadata.authors = metadata.authors.map((a) => ({
      ...a,
      name: normalizeWhitespace(a.name),
    }));
  }
  if (metadata.genres) {
    metadata.genres = metadata.genres.map(normalizeWhitespace);
  }
  if (metadata.tags) {
    metadata.tags = metadata.tags.map(normalizeWhitespace);
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

export function splitSubtitle(title: string): {
  title: string;
  subtitle?: string;
} {
  if (shisho.config.get("splitSubtitle") === "false") return { title };

  const colonIndex = title.indexOf(": ");
  if (colonIndex === -1) return { title };

  return {
    title: title.slice(0, colonIndex).trim(),
    subtitle: title.slice(colonIndex + 2).trim(),
  };
}

/**
 * Collect all identifiers from the lookup result. ISBN and ASIN values
 * are normalized and shape-checked before emission so the server never
 * receives malformed identifiers (dashes, whitespace, wrong length, or
 * a bad checksum).
 */
function collectIdentifiers(result: GRLookupResult): ParsedIdentifier[] {
  const identifiers: ParsedIdentifier[] = [];

  identifiers.push({ type: "goodreads", value: result.bookId });

  const isbn = normalizeIsbn(result.pageData.schemaOrg?.isbn ?? "");
  if (isbn.length === 13) {
    identifiers.push({ type: "isbn_13", value: isbn });
  } else if (isbn.length === 10) {
    identifiers.push({ type: "isbn_10", value: isbn });
  }

  const asin = normalizeAsin(result.pageData.schemaOrg?.asin);
  if (asin) {
    identifiers.push({ type: "asin", value: asin });
  }

  return identifiers;
}

/** Return an uppercased, shape-checked Kindle ASIN, or `undefined`. */
function normalizeAsin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const upper = raw.trim().toUpperCase();
  return /^B[A-Z0-9]{9}$/.test(upper) ? upper : undefined;
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
