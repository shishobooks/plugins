import type { OLAuthor, OLEdition, OLSearchResult, OLWork } from "./types";

const BASE_URL = "https://openlibrary.org";
const COVERS_URL = "https://covers.openlibrary.org";
const USER_AGENT =
  "ShishoPlugin/0.1.0 (open-library-enricher; github.com/shishobooks/plugins)";

/**
 * Make an HTTP request to Open Library API.
 * Returns null on 404 or other HTTP errors.
 */
function fetchJSON<T>(url: string): T | null {
  shisho.log.debug(`Fetching: ${url}`);
  const response = shisho.http.fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (response.status === 404) {
    shisho.log.debug(`Not found: ${url}`);
    return null;
  }

  if (!response.ok) {
    shisho.log.warn(
      `HTTP ${response.status} ${response.statusText} for ${url}`,
    );
    return null;
  }

  return response.json() as T;
}

/**
 * Fetch an edition by its Open Library edition ID.
 * @param editionId - Edition ID like "OL123M"
 */
export function fetchEdition(editionId: string): OLEdition | null {
  return fetchJSON<OLEdition>(`${BASE_URL}/books/${editionId}.json`);
}

/**
 * Fetch a work by its Open Library work ID.
 * @param workId - Work ID like "OL456W"
 */
export function fetchWork(workId: string): OLWork | null {
  return fetchJSON<OLWork>(`${BASE_URL}/works/${workId}.json`);
}

/**
 * Fetch an edition by ISBN.
 * @param isbn - ISBN-10 or ISBN-13
 */
export function fetchByISBN(isbn: string): OLEdition | null {
  return fetchJSON<OLEdition>(`${BASE_URL}/isbn/${isbn}.json`);
}

/**
 * Fetch an author by their Open Library author ID.
 * @param authorId - Author ID like "OL789A"
 */
export function fetchAuthor(authorId: string): OLAuthor | null {
  return fetchJSON<OLAuthor>(`${BASE_URL}/authors/${authorId}.json`);
}

/**
 * Search for books by title and optionally author.
 * @param title - Book title to search for
 * @param author - Optional author name to narrow results
 */
export function searchBooks(
  title: string,
  author?: string,
): OLSearchResult | null {
  const params: Record<string, string | number> = { title, limit: 5 };
  if (author) {
    params.author = author;
  }
  const query = shisho.url.searchParams(params);
  return fetchJSON<OLSearchResult>(`${BASE_URL}/search.json?${query}`);
}

export interface CoverResult {
  data: ArrayBuffer;
  mimeType: string;
}

/**
 * Fetch a cover image by cover ID.
 * @param coverId - Cover ID number
 * @returns Cover data with MIME type, or null if not found
 */
export function fetchCover(coverId: number): CoverResult | null {
  const url = `${COVERS_URL}/b/id/${coverId}-L.jpg`;
  shisho.log.debug(`Fetching cover: ${url}`);

  const response = shisho.http.fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    shisho.log.warn(`Failed to fetch cover ${coverId}: ${response.status}`);
    return null;
  }

  const contentType = response.headers["content-type"];
  const mimeType = contentType?.split(";")[0].trim() || "image/jpeg";

  return { data: response.arrayBuffer(), mimeType };
}
