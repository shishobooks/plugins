/**
 * Goodreads response types.
 * These represent the data structures from the Goodreads autocomplete API
 * and parsed book page HTML.
 */

/** Single result from the Goodreads autocomplete API (/book/auto_complete?format=json) */
export interface GRAutocompleteResult {
  imageUrl?: string;
  bookId: string;
  workId: string;
  bookUrl: string;
  title: string;
  bookTitleBare: string;
  numPages?: number;
  avgRating?: string;
  ratingsCount?: number;
  author: {
    id: number;
    name: string;
    isGoodreadsAuthor: boolean;
    profileUrl: string;
    worksListUrl: string;
  };
  description?: {
    html: string;
    truncated: boolean;
    fullContentUrl: string;
  };
}

/** Schema.org JSON-LD data extracted from a Goodreads book page */
export interface GRSchemaOrg {
  name: string;
  image?: string;
  bookFormat?: string;
  numberOfPages?: number;
  inLanguage?: string;
  isbn?: string;
  author?: Array<{
    name: string;
    url: string;
  }>;
}

/** Parsed data from a Goodreads book page */
export interface GRBookPageData {
  schemaOrg: GRSchemaOrg | null;
  description: string | null;
  series: string | null;
  seriesNumber: number | null;
  genres: string[];
  publisher: string | null;
  publishDate: string | null;
}

/** Combined result from lookup containing page data + optional autocomplete data */
export interface GRLookupResult {
  bookId: string;
  autocomplete?: GRAutocompleteResult;
  pageData: GRBookPageData;
}

/** Data stored in SearchResult.providerData to pass between search and enrich phases */
export interface GRProviderData {
  bookId: string;
}
