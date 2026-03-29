import type { GRAutocompleteResult } from "./types";

const BASE_URL = "https://www.goodreads.com";
const USER_AGENT =
  "ShishoPlugin/0.1.0 (goodreads-enricher; github.com/shishobooks/plugins)";

function fetchJSON<T>(url: string): T | null {
  shisho.log.debug(`Fetching: ${url}`);
  const response = shisho.http.fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response || !response.ok) {
    shisho.log.warn(`HTTP ${response?.status ?? "no response"} for ${url}`);
    return null;
  }

  return response.json() as T;
}

function fetchText(url: string): string | null {
  shisho.log.debug(`Fetching: ${url}`);
  const response = shisho.http.fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response || !response.ok) {
    shisho.log.warn(`HTTP ${response?.status ?? "no response"} for ${url}`);
    return null;
  }

  return response.text();
}

/**
 * Search for books using the Goodreads autocomplete API.
 * @param query - Search query (title, ISBN, or author)
 */
export function searchAutocomplete(
  query: string,
): GRAutocompleteResult[] | null {
  const params = shisho.url.searchParams({ format: "json", q: query });
  return fetchJSON<GRAutocompleteResult[]>(
    `${BASE_URL}/book/auto_complete?${params}`,
  );
}

/**
 * Fetch a Goodreads book page as HTML.
 * @param bookId - Goodreads book ID (numeric)
 */
export function fetchBookPage(bookId: string): string | null {
  return fetchText(`${BASE_URL}/book/show/${bookId}`);
}
