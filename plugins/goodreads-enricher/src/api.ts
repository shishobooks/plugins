import type { GRAutocompleteResult } from "./types";

const BASE_URL = "https://www.goodreads.com";
const USER_AGENT =
  "ShishoPlugin/0.1.0 (goodreads-enricher; github.com/shishobooks/plugins)";
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([503]);
const RETRY_BASE_DELAY_MS = 1000;

function fetchWithRetry(
  url: string,
  isUsableResponse: (
    response: NonNullable<ReturnType<typeof shisho.http.fetch>>,
  ) => boolean = () => true,
): ReturnType<typeof shisho.http.fetch> | null {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    shisho.log.debug(
      `Fetching: ${url}${attempt > 1 ? ` (attempt ${attempt}/${MAX_ATTEMPTS})` : ""}`,
    );
    const response = shisho.http.fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (response?.ok) {
      if (isUsableResponse(response)) return response;

      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        shisho.log.warn(
          `Unusable response for ${url}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})…`,
        );
        shisho.sleep(delay);
        continue;
      }

      shisho.log.warn(`Unusable response for ${url}`);
      return null;
    }

    const status = response?.status;
    if (status && RETRYABLE_STATUSES.has(status) && attempt < MAX_ATTEMPTS) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      shisho.log.warn(
        `HTTP ${status} for ${url}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})…`,
      );
      shisho.sleep(delay);
      continue;
    }

    shisho.log.warn(`HTTP ${status ?? "no response"} for ${url}`);
    return null;
  }
  return null;
}

function isUsableBookPage(status: number, html: string): boolean {
  if (status === 202 || html.trim().length === 0) return false;

  const normalized = html.toLowerCase();
  const challengeMarkers = [
    "window.gokuprops",
    "awswafintegration",
    "token.awswaf.com",
    "/challenge.js",
    "challenge-container",
    "<title>human verification</title>",
  ];
  return !challengeMarkers.some((marker) => normalized.includes(marker));
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
  const url = `${BASE_URL}/book/show/${bookId}`;
  let html: string | null = null;
  const response = fetchWithRetry(url, (candidate) => {
    html = candidate.text();
    return isUsableBookPage(candidate.status, html);
  });

  return response ? html : null;
}
