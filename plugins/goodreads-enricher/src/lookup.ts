import { fetchBookPage, searchAutocomplete } from "./api";
import { parseBookPage, stripHTML } from "./parsing";
import type {
  GRAutocompleteResult,
  GRLookupResult,
  GRProviderData,
} from "./types";
import {
  levenshteinDistance,
  normalizeForComparison,
} from "@shisho-plugins/shared";
import type { SearchContext, SearchResult } from "@shisho/plugin-types";

const MAX_LEVENSHTEIN_DISTANCE = 5;
const MAX_LEVENSHTEIN_RATIO = 0.4;

/**
 * Search for candidate books using the Goodreads autocomplete API.
 * Priority: Goodreads ID -> ISBN -> Title + Author
 */
export function searchForBooks(context: SearchContext): SearchResult[] {
  // 1. Try existing Goodreads ID
  const idResults = tryGoodreadsIdSearch(context);
  if (idResults.length > 0) return idResults;

  // 2. Try ISBN lookup
  const isbnResults = tryISBNSearch(context);
  if (isbnResults.length > 0) return isbnResults;

  // 3. Try title + author search
  return tryTitleAuthorSearch(context);
}

/**
 * Look up full book data from providerData (passed from search to enrich).
 *
 * The book page is the primary data source. Autocomplete is tried as optional
 * supplementary data (bare title, image URL) but enrichment proceeds without it
 * since autocomplete is a fuzzy text search and doesn't reliably resolve by ID.
 */
export function lookupByProviderData(
  providerData: GRProviderData,
): GRLookupResult | null {
  const { bookId } = providerData;
  shisho.log.info(`Enriching by Goodreads book ID: ${bookId}`);

  // Fetch the book page — this is the primary data source
  const html = fetchBookPage(bookId);
  if (!html) {
    shisho.log.warn(`Could not fetch book page for ${bookId}`);
    return null;
  }

  const pageData = parseBookPage(html);

  // Try autocomplete for supplementary data (bare title, fallback image)
  const results = searchAutocomplete(bookId);
  const autocomplete =
    results?.find((r) => r.bookId === bookId) ?? results?.[0];
  if (!autocomplete) {
    shisho.log.debug(
      `Autocomplete unavailable for book ${bookId}, using page data only`,
    );
  }

  return { bookId, autocomplete: autocomplete ?? undefined, pageData };
}

/**
 * Try search using existing Goodreads identifier.
 */
function tryGoodreadsIdSearch(context: SearchContext): SearchResult[] {
  const identifiers = context.book.identifiers ?? [];
  const goodreadsId = identifiers.find((id) => id.type === "goodreads")?.value;
  if (!goodreadsId) return [];

  shisho.log.info(`Looking up by Goodreads ID: ${goodreadsId}`);
  const results = searchAutocomplete(goodreadsId);
  const match = results?.find((r) => r.bookId === goodreadsId);

  if (match) {
    return [autocompleteToSearchResult(match)];
  }

  return [];
}

/**
 * Try search using ISBN identifiers.
 * Note: The autocomplete API is a fuzzy search, so results may not exactly match
 * the queried ISBN. There is no dedicated ISBN endpoint on Goodreads.
 */
function tryISBNSearch(context: SearchContext): SearchResult[] {
  const identifiers = context.book.identifiers ?? [];
  const isbns = identifiers
    .filter((id) => id.type === "isbn_13" || id.type === "isbn_10")
    .map((id) => id.value);

  for (const isbn of isbns) {
    shisho.log.info(`Searching by ISBN: ${isbn}`);
    const results = searchAutocomplete(isbn);
    if (results && results.length > 0) {
      return [autocompleteToSearchResult(results[0])];
    }
  }

  return [];
}

/**
 * Try search using title + author with confidence check.
 */
function tryTitleAuthorSearch(context: SearchContext): SearchResult[] {
  const title = context.query || context.book.title;
  if (!title) {
    shisho.log.debug("No title available for search");
    return [];
  }

  const authors = context.book.authors ?? [];
  const authorName = authors[0]?.name;
  const query = authorName ? `${title} ${authorName}` : title;

  shisho.log.info(
    `Searching by title: "${title}"${authorName ? ` author: "${authorName}"` : ""}`,
  );
  const results = searchAutocomplete(query);
  if (!results || results.length === 0) {
    shisho.log.debug("No search results found");
    return [];
  }

  const normalizedTarget = normalizeForComparison(title);
  const filtered: SearchResult[] = [];

  for (const result of results) {
    const normalizedResult = normalizeForComparison(result.bookTitleBare);
    const distance = levenshteinDistance(normalizedTarget, normalizedResult);
    const maxLen = Math.max(normalizedTarget.length, normalizedResult.length);

    if (
      distance > MAX_LEVENSHTEIN_DISTANCE ||
      (maxLen > 0 && distance / maxLen > MAX_LEVENSHTEIN_RATIO)
    ) {
      continue;
    }

    // If we have authors in context, require author match
    if (authors.length > 0) {
      const hasMatch = authors.some(
        (ctxAuthor) =>
          normalizeForComparison(ctxAuthor.name) ===
          normalizeForComparison(result.author.name),
      );
      if (!hasMatch) {
        shisho.log.debug(`Skipping "${result.title}" - author mismatch`);
        continue;
      }
    }

    filtered.push(autocompleteToSearchResult(result));
  }

  return filtered;
}

/**
 * Convert an autocomplete result to a SearchResult.
 * Uses the full title (with series suffix) so users can see series info
 * in the search results, since SearchResult has no dedicated series field.
 */
function autocompleteToSearchResult(
  result: GRAutocompleteResult,
): SearchResult {
  const searchResult: SearchResult = {
    title: result.title,
    authors: [result.author.name],
    providerData: { bookId: result.bookId } as GRProviderData,
    identifiers: [{ type: "goodreads", value: result.bookId }],
  };

  if (result.imageUrl) {
    searchResult.imageUrl = result.imageUrl;
  }

  if (result.description?.html) {
    searchResult.description = stripHTML(result.description.html);
  }

  return searchResult;
}
