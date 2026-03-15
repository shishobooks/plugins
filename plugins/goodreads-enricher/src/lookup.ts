import { fetchBookPage, searchAutocomplete } from "./api";
import { toMetadata } from "./mapping";
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
 *
 * For each candidate, fetches the book page and builds full metadata so the
 * user can evaluate all fields before selecting. The metadata is attached
 * via the passthrough pattern for the enrich phase.
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
    return [enrichSearchResult(match)];
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
      return [enrichSearchResult(results[0])];
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

    filtered.push(enrichSearchResult(result));
  }

  return filtered;
}

/**
 * Enrich an autocomplete result by fetching the book page and building
 * full metadata. Returns a SearchResult with all available fields populated.
 *
 * Falls back to autocomplete-only data if the book page fetch fails.
 */
function enrichSearchResult(autocomplete: GRAutocompleteResult): SearchResult {
  const bookId = autocomplete.bookId;

  // Fetch book page for rich data
  const html = fetchBookPage(bookId);
  if (!html) {
    shisho.log.debug(
      `Book page unavailable for ${bookId}, using autocomplete only`,
    );
    return autocompleteToSearchResult(autocomplete);
  }

  const pageData = parseBookPage(html);
  const lookupResult: GRLookupResult = {
    bookId,
    autocomplete,
    pageData,
  };
  const metadata = toMetadata(lookupResult);

  const searchResult: SearchResult = {
    title: metadata.title ?? autocomplete.title,
    providerData: { bookId } as GRProviderData,
    metadata,
  };

  // Populate all SearchResult display fields from metadata
  if (metadata.authors) {
    searchResult.authors = metadata.authors.map((a) => a.name);
  }
  if (metadata.description) {
    searchResult.description = metadata.description;
  }
  if (metadata.publisher) {
    searchResult.publisher = metadata.publisher;
  }
  if (metadata.releaseDate) {
    searchResult.releaseDate = metadata.releaseDate;
  }
  if (metadata.series) {
    searchResult.series = metadata.series;
    if (metadata.seriesNumber !== undefined) {
      searchResult.seriesNumber = metadata.seriesNumber;
    }
  }
  if (metadata.genres) {
    searchResult.genres = metadata.genres;
  }
  if (metadata.tags) {
    searchResult.tags = metadata.tags;
  }
  if (metadata.identifiers) {
    searchResult.identifiers = metadata.identifiers;
  }

  // Image URL for search result thumbnail
  const imageUrl =
    pageData.schemaOrg?.image ?? autocomplete.imageUrl ?? undefined;
  if (imageUrl) {
    searchResult.imageUrl = imageUrl;
  }

  return searchResult;
}

/**
 * Fallback: convert autocomplete result to SearchResult without page data.
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
