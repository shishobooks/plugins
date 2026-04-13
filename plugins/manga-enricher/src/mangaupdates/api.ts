import type { MUSearchResponse, MUSeries } from "./types";

const USER_AGENT =
  "ShishoPlugin/0.1.0 (manga-enricher; github.com/shishobooks/plugins)";

const BASE_URL = "https://api.mangaupdates.com/v1";

const SEARCH_PER_PAGE = 10;

/**
 * Search MangaUpdates for series matching the query string.
 * Returns null on HTTP error or empty query; returns the MUSeries records
 * from the search response on success.
 */
export function searchSeries(query: string): MUSeries[] | null {
  if (!query || !query.trim()) return null;

  const url = `${BASE_URL}/series/search`;
  shisho.log.debug(`MU search: ${query}`);

  const response = shisho.http.fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      search: query,
      perpage: SEARCH_PER_PAGE,
    }),
  });

  if (!response || !response.ok) {
    shisho.log.warn(
      `MU search HTTP ${response?.status ?? "no response"} for "${query}"`,
    );
    return null;
  }

  try {
    const data = response.json() as MUSearchResponse;
    return data.results.map((r) => r.record);
  } catch {
    shisho.log.warn(`MU search: failed to parse response for "${query}"`);
    return null;
  }
}

/**
 * Fetch the full series detail by MangaUpdates series_id.
 * Returns null on HTTP error or parse failure.
 */
export function fetchSeries(seriesId: number): MUSeries | null {
  const url = `${BASE_URL}/series/${seriesId}`;
  shisho.log.debug(`MU fetchSeries: ${seriesId}`);

  const response = shisho.http.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!response || !response.ok) {
    shisho.log.warn(
      `MU fetchSeries HTTP ${response?.status ?? "no response"} for ${seriesId}`,
    );
    return null;
  }

  try {
    return response.json() as MUSeries;
  } catch {
    shisho.log.warn(`MU fetchSeries: failed to parse response for ${seriesId}`);
    return null;
  }
}
