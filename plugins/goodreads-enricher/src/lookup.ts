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
 * Search for candidate books using the Goodreads autocomplete API.
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

  // Bare numeric (e.g. "5907") — treat as a Goodreads ID. normalizeIsbn
  // above already caught 10/13-digit forms, so anything left is a GR ID.
  if (/^\d+$/.test(trimmed)) return { goodreadsId: trimmed };

  return {};
}

function collectIsbns(context: SearchContext): string[] {
  const isbns: string[] = [];
  for (const id of context.identifiers ?? []) {
    if (id.type === "isbn_13" || id.type === "isbn_10") {
      if (!isbns.includes(id.value)) isbns.push(id.value);
    }
  }
  return isbns;
}

function collectAsins(context: SearchContext): string[] {
  const asins: string[] = [];
  for (const id of context.identifiers ?? []) {
    if (id.type === "asin" && !asins.includes(id.value)) {
      asins.push(id.value);
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
  metadata.url = `https://www.goodreads.com/book/show/${bookId}`;
  metadata.confidence = 1.0;
  return [metadata];
}

/**
 * ISBN lookup via autocomplete. There is no dedicated ISBN endpoint on
 * Goodreads, so we search + take the first result, then verify via the
 * book page's JSON-LD ISBN: exact match → confidence 1.0, otherwise 0.9.
 */
function lookupByIsbn(isbn: string): ParsedMetadata[] {
  shisho.log.info(`Searching by ISBN: ${isbn}`);
  const results = searchAutocomplete(isbn);
  if (!results || results.length === 0) return [];

  const enriched = enrichSearchResult(results[0], 0.9);
  if (hasMatchingIsbn(enriched, isbn)) {
    enriched.confidence = 1.0;
  }
  return [enriched];
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

/**
 * ASIN lookup via autocomplete, same shape as ISBN: Goodreads has no
 * dedicated ASIN endpoint, so we search, take the first result, and
 * verify via the book page's Apollo ASIN. Match → confidence 1.0;
 * otherwise 0.9 (still usable, just not verified exact).
 */
function lookupByAsin(asin: string): ParsedMetadata[] {
  shisho.log.info(`Searching by ASIN: ${asin}`);
  const results = searchAutocomplete(asin);
  if (!results || results.length === 0) return [];

  const enriched = enrichSearchResult(results[0], 0.9);
  if (hasMatchingAsin(enriched, asin)) {
    enriched.confidence = 1.0;
  }
  return [enriched];
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

  metadata.url = `https://www.goodreads.com/book/show/${bookId}`;
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
