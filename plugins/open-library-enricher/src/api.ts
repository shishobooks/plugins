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
 * Encode a string for use in URL query parameters.
 * Goja runtime doesn't have encodeURIComponent, so we implement it manually.
 */
function encodeParam(str: string): string {
  // Characters that don't need encoding in query params
  const safe =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~";
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (safe.includes(char)) {
      result += char;
    } else {
      // Encode as %XX for each byte of UTF-8
      const bytes = encodeCharToUTF8Bytes(char);
      for (const byte of bytes) {
        result += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
      }
    }
  }
  return result;
}

/**
 * Convert a character to its UTF-8 byte representation.
 */
function encodeCharToUTF8Bytes(char: string): number[] {
  const code = char.charCodeAt(0);
  if (code < 0x80) {
    return [code];
  } else if (code < 0x800) {
    return [0xc0 | (code >> 6), 0x80 | (code & 0x3f)];
  } else if (code < 0x10000) {
    return [
      0xe0 | (code >> 12),
      0x80 | ((code >> 6) & 0x3f),
      0x80 | (code & 0x3f),
    ];
  } else {
    return [
      0xf0 | (code >> 18),
      0x80 | ((code >> 12) & 0x3f),
      0x80 | ((code >> 6) & 0x3f),
      0x80 | (code & 0x3f),
    ];
  }
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
  let query = `title=${encodeParam(title)}`;
  if (author) {
    query += `&author=${encodeParam(author)}`;
  }
  query += "&limit=5"; // Only need top results
  return fetchJSON<OLSearchResult>(`${BASE_URL}/search.json?${query}`);
}

/**
 * Fetch a cover image by cover ID.
 * @param coverId - Cover ID number
 * @returns ArrayBuffer of JPEG image data, or null if not found
 */
export function fetchCover(coverId: number): ArrayBuffer | null {
  const url = `${COVERS_URL}/b/id/${coverId}-L.jpg`;
  shisho.log.debug(`Fetching cover: ${url}`);

  const response = shisho.http.fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    shisho.log.warn(`Failed to fetch cover ${coverId}: ${response.status}`);
    return null;
  }

  return response.arrayBuffer();
}
