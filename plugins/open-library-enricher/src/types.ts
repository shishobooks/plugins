/**
 * Open Library API response types.
 * These represent the JSON structures returned by the Open Library API.
 */

/** Edition (book) response from /books/{id}.json or /isbn/{isbn}.json */
export interface OLEdition {
  key: string; // "/books/OL123M"
  title: string;
  subtitle?: string;
  publishers?: string[];
  publish_date?: string;
  isbn_10?: string[];
  isbn_13?: string[];
  covers?: number[];
  works?: Array<{ key: string }>; // [{ key: "/works/OL456W" }]
  contributors?: Array<{
    name: string;
    role: string;
  }>;
  series?: string[];
  identifiers?: {
    goodreads?: string[];
    librarything?: string[];
    [key: string]: string[] | undefined;
  };
}

/** Work response from /works/{id}.json */
export interface OLWork {
  key: string; // "/works/OL456W"
  title: string;
  subtitle?: string;
  description?: string | { type?: string; value: string };
  authors?: Array<{ author: { key: string } }>;
  covers?: number[];
  subjects?: string[];
  series?: string[];
}

/** Author response from /authors/{id}.json */
export interface OLAuthor {
  key: string; // "/authors/OL789A"
  name: string;
  personal_name?: string;
  alternate_names?: string[];
}

/** Search result from /search.json */
export interface OLSearchResult {
  numFound: number;
  start: number;
  docs: OLSearchDoc[];
}

/** Combined result from lookup containing both edition and work data. */
export interface OLLookupResult {
  edition: OLEdition;
  work: OLWork;
  authors: OLAuthor[];
}

/** Individual search result document */
export interface OLSearchDoc {
  key: string; // "/works/OL456W"
  title: string;
  author_name?: string[];
  author_key?: string[];
  first_publish_year?: number;
  cover_i?: number;
  edition_key?: string[];
  isbn?: string[];
}
