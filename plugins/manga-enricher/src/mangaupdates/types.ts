/**
 * A single series record from MangaUpdates — used by both search and
 * the series detail endpoint. Search returns a subset of these fields.
 */
export interface MUSeries {
  series_id: number;
  title: string;
  url?: string;
  description?: string;
  type?: string;
  year?: string;
  status?: string;
  associated?: Array<{ title: string }>;
  genres?: Array<{ genre: string }>;
  categories?: Array<{ category: string; votes?: number }>;
  authors?: Array<{ name: string; author_id?: number; type?: string }>;
  publishers?: Array<{
    publisher_name: string;
    publisher_id?: number;
    type?: string;
    notes?: string;
  }>;
}

/** Envelope for `POST /v1/series/search` */
export interface MUSearchResponse {
  total_hits: number;
  page: number;
  per_page: number;
  results: Array<{
    record: MUSeries;
    hit_title?: string;
  }>;
}
