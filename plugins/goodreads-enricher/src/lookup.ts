import { fetchBookPage, searchAutocomplete } from "./api";
import { cleanTitle, stripImageSuffix, toMetadata } from "./mapping";
import { parseBookPage } from "./parsing";
import type { GRAutocompleteResult, GRLookupResult } from "./types";
import {
  normalizeForComparison,
  stripHTML,
  titleMatchConfidence,
} from "@shisho-plugins/shared";
import type { ParsedMetadata, SearchContext } from "@shisho/plugin-sdk";

/**
 * Search for candidate books using the Goodreads autocomplete API.
 * Priority: Goodreads ID -> ISBN -> Title + Author
 *
 * For each candidate, fetches the book page and builds full metadata
 * so the server can apply it directly when the user selects a result.
 */
export function searchForBooks(context: SearchContext): ParsedMetadata[] {
  // 1. Try existing Goodreads ID
  const idResults = tryGoodreadsIdSearch(context);
  if (idResults.length > 0) return idResults;

  // 2. Try ISBN lookup
  const isbnResults = tryISBNSearch(context);
  if (isbnResults.length > 0) return isbnResults;

  // 3. Title + author search
  return tryTitleAuthorSearch(context);
}

/**
 * Try search using existing Goodreads identifier.
 */
function tryGoodreadsIdSearch(context: SearchContext): ParsedMetadata[] {
  const identifiers = context.identifiers ?? [];
  const goodreadsId = identifiers.find((id) => id.type === "goodreads")?.value;
  if (!goodreadsId) return [];

  shisho.log.info(`Looking up by Goodreads ID: ${goodreadsId}`);
  const results = searchAutocomplete(goodreadsId);
  const match = results?.find((r) => r.bookId === goodreadsId);

  if (match) {
    return [enrichSearchResult(match, 1.0)];
  }

  return [];
}

/**
 * Try search using ISBN identifiers.
 * Note: The autocomplete API is a fuzzy search, so results may not exactly match
 * the queried ISBN. There is no dedicated ISBN endpoint on Goodreads.
 */
function tryISBNSearch(context: SearchContext): ParsedMetadata[] {
  const identifiers = context.identifiers ?? [];
  const isbns = identifiers
    .filter((id) => id.type === "isbn_13" || id.type === "isbn_10")
    .map((id) => id.value);

  for (const isbn of isbns) {
    shisho.log.info(`Searching by ISBN: ${isbn}`);
    const results = searchAutocomplete(isbn);
    if (results && results.length > 0) {
      return [enrichSearchResult(results[0], 0.9)];
    }
  }

  return [];
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
