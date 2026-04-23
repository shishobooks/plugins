import { fetchBookPage, searchAutocomplete } from "./api";
import { cleanTitle, stripImageSuffix, toMetadata } from "./mapping";
import { parseBookPage } from "./parsing";
import type { GRAutocompleteResult, GRLookupResult } from "./types";
import {
  isbnsMatch,
  normalizeForComparison,
  normalizeIsbn,
  stripHTML,
  titleMatchConfidence,
} from "@shisho-plugins/shared";
import type { ParsedMetadata, SearchContext } from "@shisho/plugin-sdk";

/**
 * Search for candidate books across Goodreads' book-page and autocomplete
 * endpoints.
 *
 * Priority:
 *   1. Query-embedded identifier (URL / GR ID / ISBN / ASIN) — wins over
 *      every file-metadata identifier and disables the title fallback.
 *   2. File-metadata Goodreads ID.
 *   3. File-metadata ISBN.
 *   4. File-metadata ASIN.
 *   5. Fuzzy title + author search.
 *
 * For each candidate, fetches the book page and builds full metadata
 * so the server can apply it directly when the user selects a result.
 */
export function searchForBooks(context: SearchContext): ParsedMetadata[] {
  const fromQuery = extractQueryIdentifiers(context.query ?? "");

  // A query-typed identifier trumps ALL file-metadata identifiers. If the
  // user typed a URL/ID/ISBN/ASIN they're asking for a specific book —
  // honour that over whatever happens to be on the file, and don't fall
  // back to a fuzzy title search on a miss.
  if (fromQuery.goodreadsId) return lookupByGoodreadsId(fromQuery.goodreadsId);
  if (fromQuery.isbn) return lookupByIsbn(fromQuery.isbn);
  if (fromQuery.asin) return lookupByAsin(fromQuery.asin);

  const goodreadsId = context.identifiers?.find(
    (id) => id.type === "goodreads",
  )?.value;
  if (goodreadsId) {
    const results = lookupByGoodreadsId(goodreadsId);
    if (results.length > 0) return results;
  }

  for (const isbn of collectIsbns(context)) {
    const results = lookupByIsbn(isbn);
    if (results.length > 0) return results;
  }

  for (const asin of collectAsins(context)) {
    const results = lookupByAsin(asin);
    if (results.length > 0) return results;
  }

  return tryTitleAuthorSearch(context);
}

/**
 * Parse a free-text query for directly-usable identifiers. Users often
 * paste a Goodreads URL, ISBN, or ASIN into the title field when they
 * want a specific book.
 */
export function extractQueryIdentifiers(query: string): {
  goodreadsId?: string;
  isbn?: string;
  asin?: string;
} {
  const trimmed = query.trim();
  if (!trimmed) return {};

  // Goodreads URL — accept with or without scheme, and ignore any slug suffix.
  const urlMatch = trimmed.match(/goodreads\.com\/book\/show\/(\d+)/i);
  if (urlMatch) return { goodreadsId: urlMatch[1] };

  // ISBN, tolerant of dashes/spaces and a trailing X checksum.
  const normalizedIsbn = normalizeIsbn(trimmed);
  if (normalizedIsbn) return { isbn: normalizedIsbn };

  // Kindle-style ASIN: B + 9 alphanumerics. Pure-digit 10-char strings are
  // treated as ISBN-10 above, so this only catches Amazon-origin ASINs.
  if (/^B[A-Z0-9]{9}$/i.test(trimmed)) return { asin: trimmed.toUpperCase() };

  // Bare numeric (e.g. "5907") — treat as a Goodreads ID. Note that
  // `normalizeIsbn` above rejects bad-checksum 10/13-digit values, so a
  // 13-digit non-ISBN falls through here and we let the page fetch
  // decide whether the ID actually exists.
  if (/^\d+$/.test(trimmed)) return { goodreadsId: trimmed };

  return {};
}

/**
 * Collect ISBN values from `context.identifiers`, normalizing each so
 * the autocomplete query sees a clean digit-only string (dashes,
 * whitespace, and bad-checksum values are dropped). Mirrors the
 * `extractQueryIdentifiers` normalization applied to query-typed input.
 */
function collectIsbns(context: SearchContext): string[] {
  const isbns: string[] = [];
  for (const id of context.identifiers ?? []) {
    if (id.type !== "isbn_13" && id.type !== "isbn_10") continue;
    const normalized = normalizeIsbn(id.value);
    if (normalized && !isbns.includes(normalized)) isbns.push(normalized);
  }
  return isbns;
}

/**
 * Collect ASIN values from `context.identifiers`, uppercasing and
 * shape-checking each so autocomplete sees only well-formed Kindle
 * ASINs (B + 9 alphanumerics).
 */
function collectAsins(context: SearchContext): string[] {
  const asins: string[] = [];
  for (const id of context.identifiers ?? []) {
    if (id.type !== "asin") continue;
    const upper = id.value.trim().toUpperCase();
    if (/^B[A-Z0-9]{9}$/.test(upper) && !asins.includes(upper)) {
      asins.push(upper);
    }
  }
  return asins;
}

/**
 * Direct book-page lookup by Goodreads ID. The autocomplete endpoint isn't
 * guaranteed to surface an arbitrary ID, so we fetch the book page directly
 * for a real exact match.
 */
function lookupByGoodreadsId(bookId: string): ParsedMetadata[] {
  shisho.log.info(`Looking up by Goodreads ID: ${bookId}`);
  const html = fetchBookPage(bookId);
  if (!html) return [];

  const pageData = parseBookPage(html);
  const metadata = toMetadata({ bookId, pageData });
  metadata.confidence = 1.0;
  return [metadata];
}

/**
 * ISBN lookup via autocomplete. There is no dedicated ISBN endpoint on
 * Goodreads, so we search + take the first result and try to verify it
 * against the book page's JSON-LD ISBN:
 *   - Verified match           → confidence 1.0
 *   - Page fetched, no match   → drop the result entirely (the top
 *                                autocomplete hit was a near-miss for
 *                                a different book)
 *   - Page fetch failed        → confidence 0.9 (can't verify, but
 *                                autocomplete said this was the best
 *                                hit so we still surface it)
 */
function lookupByIsbn(isbn: string): ParsedMetadata[] {
  shisho.log.info(`Searching by ISBN: ${isbn}`);
  const results = searchAutocomplete(isbn);
  if (!results || results.length === 0) return [];

  return verifyAutocompleteMatch(results[0], (metadata) =>
    hasMatchingIsbn(metadata, isbn),
  );
}

/**
 * ASIN lookup via autocomplete — same shape and verification policy as
 * {@link lookupByIsbn}.
 */
function lookupByAsin(asin: string): ParsedMetadata[] {
  shisho.log.info(`Searching by ASIN: ${asin}`);
  const results = searchAutocomplete(asin);
  if (!results || results.length === 0) return [];

  return verifyAutocompleteMatch(results[0], (metadata) =>
    hasMatchingAsin(metadata, asin),
  );
}

/**
 * Verify an autocomplete hit by fetching its book page. Returns a
 * three-way outcome: verified match (1.0), unverifiable fetch failure
 * (0.9 from autocomplete data), or verified mismatch (dropped).
 */
function verifyAutocompleteMatch(
  autocomplete: GRAutocompleteResult,
  isMatch: (metadata: ParsedMetadata) => boolean,
): ParsedMetadata[] {
  const bookId = autocomplete.bookId;
  const html = fetchBookPage(bookId);
  if (!html) {
    shisho.log.debug(
      `Book page unavailable for ${bookId}; returning unverified autocomplete result`,
    );
    return [autocompleteToMetadata(autocomplete, 0.9)];
  }

  const pageData = parseBookPage(html);
  const metadata = toMetadata({ bookId, autocomplete, pageData });
  if (!metadata.coverUrl && autocomplete.imageUrl) {
    metadata.coverUrl = stripImageSuffix(autocomplete.imageUrl);
  }

  if (!isMatch(metadata)) {
    shisho.log.debug(
      `Book ${bookId} failed identifier verification; dropping result`,
    );
    return [];
  }

  metadata.confidence = 1.0;
  return [metadata];
}

function hasMatchingIsbn(metadata: ParsedMetadata, isbn: string): boolean {
  return (
    metadata.identifiers?.some(
      (id) =>
        (id.type === "isbn_13" || id.type === "isbn_10") &&
        isbnsMatch(id.value, isbn),
    ) ?? false
  );
}

function hasMatchingAsin(metadata: ParsedMetadata, asin: string): boolean {
  const target = asin.toUpperCase();
  return (
    metadata.identifiers?.some(
      (id) => id.type === "asin" && id.value.toUpperCase() === target,
    ) ?? false
  );
}

/**
 * Try search using title + author with confidence check.
 */
function tryTitleAuthorSearch(context: SearchContext): ParsedMetadata[] {
  const title = context.query;
  if (!title) {
    shisho.log.debug("No title available for search");
    return [];
  }

  const authorName = context.author;
  const query = authorName ? `${title} ${authorName}` : title;

  shisho.log.info(
    `Searching by title: "${title}"${authorName ? ` author: "${authorName}"` : ""}`,
  );
  const results = searchAutocomplete(query);
  if (!results || results.length === 0) {
    shisho.log.debug("No search results found");
    return [];
  }

  // Preserve API relevance order; score via titleMatchConfidence so a
  // subtitle in either side (query or result) doesn't tank the score.
  const matches: ParsedMetadata[] = [];

  for (const result of results) {
    // If we have an author in context, require match
    if (authorName) {
      const normalizedAuthor = normalizeForComparison(authorName);
      if (normalizeForComparison(result.author.name) !== normalizedAuthor) {
        shisho.log.debug(`Skipping "${result.title}" - author mismatch`);
        continue;
      }
    }

    const confidence = titleMatchConfidence(title, result.bookTitleBare);
    matches.push(enrichSearchResult(result, confidence));
  }

  return matches;
}

/**
 * Enrich an autocomplete result by fetching the book page and building
 * full ParsedMetadata. The server applies this directly when the user
 * selects a result.
 *
 * Falls back to autocomplete-only data if the book page fetch fails.
 */
function enrichSearchResult(
  autocomplete: GRAutocompleteResult,
  confidence: number,
): ParsedMetadata {
  const bookId = autocomplete.bookId;

  // Fetch book page for rich data
  const html = fetchBookPage(bookId);
  if (!html) {
    shisho.log.debug(
      `Book page unavailable for ${bookId}, using autocomplete only`,
    );
    return autocompleteToMetadata(autocomplete, confidence);
  }

  const pageData = parseBookPage(html);
  const lookupResult: GRLookupResult = { bookId, autocomplete, pageData };
  const metadata = toMetadata(lookupResult);

  // Use full-size cover, falling back to stripped autocomplete image
  if (!metadata.coverUrl && autocomplete.imageUrl) {
    metadata.coverUrl = stripImageSuffix(autocomplete.imageUrl);
  }

  metadata.confidence = confidence;

  return metadata;
}

/**
 * Fallback: convert autocomplete result to ParsedMetadata without page data.
 */
function autocompleteToMetadata(
  result: GRAutocompleteResult,
  confidence: number,
): ParsedMetadata {
  const metadata: ParsedMetadata = {
    title: cleanTitle(result.bookTitleBare ?? result.title),
    authors: [{ name: result.author.name }],
    identifiers: [{ type: "goodreads", value: result.bookId }],
    url: `https://www.goodreads.com/book/show/${result.bookId}`,
    confidence,
  };

  if (result.imageUrl) {
    metadata.coverUrl = stripImageSuffix(result.imageUrl);
  }

  if (result.description?.html) {
    metadata.description = stripHTML(result.description.html);
  }

  return metadata;
}
