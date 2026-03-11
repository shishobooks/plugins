import { fetchBookPage, searchAutocomplete } from "./api";
import { parseBookPage, stripHTML } from "./parsing";
import type {
  GRAutocompleteResult,
  GRLookupResult,
  GRProviderData,
} from "./types";
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
 */
export function lookupByProviderData(
  providerData: GRProviderData,
): GRLookupResult | null {
  const { bookId } = providerData;
  shisho.log.info(`Enriching by Goodreads book ID: ${bookId}`);

  // Search autocomplete to get basic info
  const results = searchAutocomplete(bookId);
  const autocomplete =
    results?.find((r) => r.bookId === bookId) ?? results?.[0];
  if (!autocomplete) {
    shisho.log.warn(`Could not find book ${bookId} in autocomplete`);
    return null;
  }

  // Fetch the book page for detailed metadata
  const html = fetchBookPage(bookId);
  if (!html) {
    shisho.log.warn(`Could not fetch book page for ${bookId}`);
    return null;
  }

  const pageData = parseBookPage(html);
  return { bookId, autocomplete, pageData };
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
 */
function autocompleteToSearchResult(
  result: GRAutocompleteResult,
): SearchResult {
  const searchResult: SearchResult = {
    title: result.bookTitleBare,
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
