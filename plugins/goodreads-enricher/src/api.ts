import type { GRAutocompleteResult } from "./types";

const BASE_URL = "https://www.goodreads.com";
const USER_AGENT =
  "ShishoPlugin/0.1.0 (goodreads-enricher; github.com/shishobooks/plugins)";
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([503]);

function fetchWithRetry(
  url: string,
): ReturnType<typeof shisho.http.fetch> | null {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    shisho.log.debug(
      `Fetching: ${url}${attempt > 1 ? ` (attempt ${attempt}/${MAX_ATTEMPTS})` : ""}`,
    );
    const response = shisho.http.fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (response?.ok) {
      return response;
    }

    const status = response?.status;
    if (status && RETRYABLE_STATUSES.has(status) && attempt < MAX_ATTEMPTS) {
      shisho.log.warn(
        `HTTP ${status} for ${url}, retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})…`,
      );
      continue;
    }

    shisho.log.warn(`HTTP ${status ?? "no response"} for ${url}`);
    return null;
  }
  return null;
}

function fetchJSON<T>(url: string): T | null {
  const response = fetchWithRetry(url);
  if (!response) return null;

  try {
    return response.json() as T;
  } catch {
    shisho.log.warn(`Failed to parse JSON from ${url}`);
    return null;
  }
}

function fetchText(url: string): string | null {
  const response = fetchWithRetry(url);
  if (!response) return null;

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
