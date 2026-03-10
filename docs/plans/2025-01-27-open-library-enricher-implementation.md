# Open Library Enricher Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a metadata enricher plugin that fetches book data from Open Library API to enrich books in a user's library.

**Architecture:** The plugin uses a priority-based lookup chain (existing OL IDs → ISBN → title/author search) to find books, then maps Open Library responses to Shisho's ParsedMetadata format. All HTTP requests go through the `shisho.http.fetch()` host API.

**Tech Stack:** TypeScript, esbuild (IIFE bundle), @shisho/plugin-types

---

## Task 1: Utility Functions (utils.ts)

**Files:**
- Create: `plugins/open-library-enricher/src/utils.ts`

**Step 1: Create utils.ts with all utility functions**

```typescript
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
 * Convert a string to title case.
 */
export function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Extract the ID portion from an Open Library key.
 * E.g., "/works/OL123W" -> "OL123W", "/books/OL456M" -> "OL456M"
 */
export function extractOLId(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1];
}

/**
 * Parse Open Library date formats to ISO 8601.
 * Handles: "1954", "June 1954", "Jun 15, 1954", "June 15, 1954"
 * Returns undefined if unparseable.
 */
export function parseOLDate(dateStr: string): string | undefined {
  if (!dateStr) return undefined;

  const trimmed = dateStr.trim();

  // Year only: "1954"
  if (/^\d{4}$/.test(trimmed)) {
    return `${trimmed}-01-01`;
  }

  // Month Year: "June 1954" or "Jun 1954"
  const monthYearMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const month = parseMonth(monthYearMatch[1]);
    if (month) {
      return `${monthYearMatch[2]}-${month}-01`;
    }
  }

  // Full date: "Jun 15, 1954" or "June 15, 1954"
  const fullDateMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (fullDateMatch) {
    const month = parseMonth(fullDateMatch[1]);
    if (month) {
      const day = fullDateMatch[2].padStart(2, "0");
      return `${fullDateMatch[3]}-${month}-${day}`;
    }
  }

  // ISO-like: "1954-06-15"
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}

/**
 * Parse month name to 2-digit string.
 */
function parseMonth(monthStr: string): string | undefined {
  const months: Record<string, string> = {
    january: "01",
    jan: "01",
    february: "02",
    feb: "02",
    march: "03",
    mar: "03",
    april: "04",
    apr: "04",
    may: "05",
    june: "06",
    jun: "06",
    july: "07",
    jul: "07",
    august: "08",
    aug: "08",
    september: "09",
    sep: "09",
    sept: "09",
    october: "10",
    oct: "10",
    november: "11",
    nov: "11",
    december: "12",
    dec: "12",
  };
  return months[monthStr.toLowerCase()];
}

/**
 * Parse series number from a series string.
 * E.g., "Book 2" -> 2, "Vol. 3" -> 3, "#5" -> 5
 */
export function parseSeriesNumber(seriesStr: string): number | undefined {
  // Look for patterns like "Book 2", "Vol. 3", "#5", "Part 1"
  const match = seriesStr.match(
    /(?:book|vol\.?|volume|part|#|no\.?|number)\s*(\d+)/i,
  );
  if (match) {
    return parseInt(match[1], 10);
  }

  // Look for trailing number: "Series Name 2"
  const trailingMatch = seriesStr.match(/\s(\d+)$/);
  if (trailingMatch) {
    return parseInt(trailingMatch[1], 10);
  }

  return undefined;
}

/**
 * Normalize description from Open Library format.
 * Can be string or { type: "/type/text", value: "..." }
 */
export function normalizeDescription(
  desc: string | { type?: string; value: string } | undefined,
): string | undefined {
  if (!desc) return undefined;
  if (typeof desc === "string") return desc;
  if (typeof desc === "object" && "value" in desc) return desc.value;
  return undefined;
}
```

**Step 2: Verify build succeeds**

Run: `yarn build`
Expected: Build completes without errors

**Step 3: Commit**

```bash
git add plugins/open-library-enricher/src/utils.ts
git commit -m "feat(open-library): add utility functions for parsing and normalization"
```

---

## Task 2: Open Library Type Definitions (types.ts)

**Files:**
- Create: `plugins/open-library-enricher/src/types.ts`

**Step 1: Create types.ts with Open Library API response types**

```typescript
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

/** Combined result from lookup containing both edition and work data */
export interface OLLookupResult {
  edition: OLEdition;
  work: OLWork;
  authors: OLAuthor[];
}
```

**Step 2: Verify build succeeds**

Run: `yarn build`
Expected: Build completes without errors

**Step 3: Commit**

```bash
git add plugins/open-library-enricher/src/types.ts
git commit -m "feat(open-library): add Open Library API type definitions"
```

---

## Task 3: API Module (api.ts)

**Files:**
- Create: `plugins/open-library-enricher/src/api.ts`

**Step 1: Create api.ts with Open Library API functions**

```typescript
import type {
  OLAuthor,
  OLEdition,
  OLSearchResult,
  OLWork,
} from "./types";

const BASE_URL = "https://openlibrary.org";
const COVERS_URL = "https://covers.openlibrary.org";
const USER_AGENT =
  "ShishoPlugin/0.1.0 (open-library-enricher; github.com/shishobooks/plugins)";

/**
 * Make an HTTP request to Open Library API.
 * Returns null on 404, throws on other errors.
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
  const params = new URLSearchParams({ title });
  if (author) {
    params.set("author", author);
  }
  params.set("limit", "5"); // Only need top results
  return fetchJSON<OLSearchResult>(`${BASE_URL}/search.json?${params}`);
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
```

**Step 2: Verify build succeeds**

Run: `yarn build`
Expected: Build completes without errors

**Step 3: Commit**

```bash
git add plugins/open-library-enricher/src/api.ts
git commit -m "feat(open-library): add API module for Open Library requests"
```

---

## Task 4: Lookup Module (lookup.ts)

**Files:**
- Create: `plugins/open-library-enricher/src/lookup.ts`

**Step 1: Create lookup.ts with the lookup strategy chain**

```typescript
import type { MetadataEnricherContext } from "@shisho/plugin-types";

import {
  fetchAuthor,
  fetchByISBN,
  fetchEdition,
  fetchWork,
  searchBooks,
} from "./api";
import type { OLAuthor, OLLookupResult, OLSearchDoc } from "./types";
import {
  extractOLId,
  levenshteinDistance,
  normalizeForComparison,
} from "./utils";

const MAX_LEVENSHTEIN_DISTANCE = 5;

/**
 * Find a book in Open Library using the priority lookup chain:
 * 1. Existing Open Library IDs (edition or work)
 * 2. ISBN lookup
 * 3. Title + Author search (with confidence check)
 *
 * @returns Lookup result with edition, work, and authors, or null if not found
 */
export function findBook(
  context: MetadataEnricherContext,
): OLLookupResult | null {
  // 1. Try existing Open Library IDs
  const existingResult = tryExistingIds(context);
  if (existingResult) return existingResult;

  // 2. Try ISBN lookup
  const isbnResult = tryISBNLookup(context);
  if (isbnResult) return isbnResult;

  // 3. Try title + author search
  return tryTitleAuthorSearch(context);
}

/**
 * Try lookup using existing Open Library identifiers.
 */
function tryExistingIds(
  context: MetadataEnricherContext,
): OLLookupResult | null {
  const identifiers = [
    ...(context.parsedMetadata.identifiers ?? []),
    ...(context.book.identifiers ?? []),
  ];

  // Try edition ID first (more specific)
  const editionId = identifiers.find(
    (id) => id.type === "openlibrary_edition",
  )?.value;
  if (editionId) {
    shisho.log.info(`Looking up by edition ID: ${editionId}`);
    const edition = fetchEdition(editionId);
    if (edition) {
      return completeEditionLookup(edition);
    }
  }

  // Try work ID
  const workId = identifiers.find(
    (id) => id.type === "openlibrary_work",
  )?.value;
  if (workId) {
    shisho.log.info(`Looking up by work ID: ${workId}`);
    const work = fetchWork(workId);
    if (work) {
      return completeWorkLookup(work);
    }
  }

  return null;
}

/**
 * Try lookup using ISBN identifiers.
 */
function tryISBNLookup(context: MetadataEnricherContext): OLLookupResult | null {
  const identifiers = [
    ...(context.parsedMetadata.identifiers ?? []),
    ...(context.book.identifiers ?? []),
  ];

  // Try ISBN-13 first, then ISBN-10
  const isbns = identifiers
    .filter((id) => id.type === "isbn_13" || id.type === "isbn_10")
    .map((id) => id.value);

  for (const isbn of isbns) {
    shisho.log.info(`Looking up by ISBN: ${isbn}`);
    const edition = fetchByISBN(isbn);
    if (edition) {
      return completeEditionLookup(edition);
    }
  }

  return null;
}

/**
 * Try lookup using title + author search with confidence check.
 */
function tryTitleAuthorSearch(
  context: MetadataEnricherContext,
): OLLookupResult | null {
  const title =
    context.parsedMetadata.title ?? context.book.title;
  if (!title) {
    shisho.log.debug("No title available for search");
    return null;
  }

  // Get author name for search
  const authors = [
    ...(context.parsedMetadata.authors ?? []),
    ...(context.book.authors ?? []),
  ];
  const authorName = authors[0]?.name;

  shisho.log.info(
    `Searching by title: "${title}"${authorName ? ` author: "${authorName}"` : ""}`,
  );
  const searchResult = searchBooks(title, authorName);
  if (!searchResult || searchResult.numFound === 0) {
    shisho.log.debug("No search results found");
    return null;
  }

  // Find best matching result
  const match = findBestMatch(searchResult.docs, title, authors);
  if (!match) {
    shisho.log.debug("No confident match found in search results");
    return null;
  }

  // Fetch the work details
  const workId = extractOLId(match.key);
  shisho.log.info(`Found match: ${match.title} (${workId})`);
  const work = fetchWork(workId);
  if (!work) return null;

  return completeWorkLookup(work);
}

/**
 * Find the best matching search result with confidence check.
 */
function findBestMatch(
  docs: OLSearchDoc[],
  targetTitle: string,
  contextAuthors: Array<{ name: string }>,
): OLSearchDoc | null {
  const normalizedTarget = normalizeForComparison(targetTitle);

  for (const doc of docs) {
    const normalizedDoc = normalizeForComparison(doc.title);
    const distance = levenshteinDistance(normalizedTarget, normalizedDoc);

    if (distance > MAX_LEVENSHTEIN_DISTANCE) {
      continue;
    }

    // If we have authors in context, require at least one overlap
    if (contextAuthors.length > 0 && doc.author_name) {
      const hasAuthorMatch = contextAuthors.some((ctxAuthor) =>
        doc.author_name!.some(
          (docAuthor) =>
            normalizeForComparison(ctxAuthor.name) ===
            normalizeForComparison(docAuthor),
        ),
      );
      if (!hasAuthorMatch) {
        shisho.log.debug(
          `Skipping "${doc.title}" - no author match`,
        );
        continue;
      }
    }

    return doc;
  }

  return null;
}

/**
 * Complete lookup starting from an edition: fetch work and authors.
 */
function completeEditionLookup(edition: OLEdition): OLLookupResult | null {
  // Get work from edition
  const workKey = edition.works?.[0]?.key;
  if (!workKey) {
    shisho.log.warn("Edition has no associated work");
    return null;
  }

  const workId = extractOLId(workKey);
  const work = fetchWork(workId);
  if (!work) return null;

  const authors = fetchAuthors(work);
  return { edition, work, authors };
}

/**
 * Complete lookup starting from a work: fetch first edition and authors.
 */
function completeWorkLookup(work: OLWork): OLLookupResult | null {
  // We need to find an edition for this work
  // Search for the work title to get edition keys
  const searchResult = searchBooks(work.title);
  if (!searchResult || searchResult.numFound === 0) {
    shisho.log.warn("Could not find edition for work");
    return null;
  }

  // Find a matching doc with the same work key
  const workId = extractOLId(work.key);
  const matchingDoc = searchResult.docs.find((doc) =>
    doc.key === work.key || extractOLId(doc.key) === workId
  );

  if (matchingDoc?.edition_key?.[0]) {
    const edition = fetchEdition(matchingDoc.edition_key[0]);
    if (edition) {
      const authors = fetchAuthors(work);
      return { edition, work, authors };
    }
  }

  // Return with minimal edition data
  const authors = fetchAuthors(work);
  return {
    edition: {
      key: "",
      title: work.title,
      covers: work.covers,
    },
    work,
    authors,
  };
}

/**
 * Fetch author details for a work.
 */
function fetchAuthors(work: OLWork): OLAuthor[] {
  const authors: OLAuthor[] = [];

  for (const authorRef of work.authors ?? []) {
    const authorId = extractOLId(authorRef.author.key);
    const author = fetchAuthor(authorId);
    if (author) {
      authors.push(author);
    }
  }

  return authors;
}
```

**Step 2: Verify build succeeds**

Run: `yarn build`
Expected: Build completes without errors

**Step 3: Commit**

```bash
git add plugins/open-library-enricher/src/lookup.ts
git commit -m "feat(open-library): add lookup module with priority chain strategy"
```

---

## Task 5: Mapping Module (mapping.ts)

**Files:**
- Create: `plugins/open-library-enricher/src/mapping.ts`

**Step 1: Create mapping.ts to transform OL responses to ParsedMetadata**

```typescript
import type { ParsedAuthor, ParsedIdentifier, ParsedMetadata } from "@shisho/plugin-types";

import { fetchCover } from "./api";
import type { OLLookupResult } from "./types";
import {
  extractOLId,
  normalizeDescription,
  parseOLDate,
  parseSeriesNumber,
  toTitleCase,
} from "./utils";

/**
 * Transform Open Library lookup result to Shisho ParsedMetadata.
 */
export function toMetadata(result: OLLookupResult): ParsedMetadata {
  const { edition, work, authors } = result;

  const metadata: ParsedMetadata = {};

  // Title (prefer edition)
  metadata.title = edition.title || work.title;

  // Subtitle
  if (edition.subtitle) {
    metadata.subtitle = edition.subtitle;
  }

  // Authors
  if (authors.length > 0) {
    metadata.authors = authors.map(
      (a): ParsedAuthor => ({
        name: a.name,
      }),
    );
  }

  // Narrators (from contributors with Narrator/Reader role)
  const narrators = edition.contributors
    ?.filter((c) => c.role.toLowerCase().includes("narrator") ||
                    c.role.toLowerCase().includes("reader"))
    .map((c) => c.name);
  if (narrators && narrators.length > 0) {
    metadata.narrators = narrators;
  }

  // Description
  const description = normalizeDescription(work.description);
  if (description) {
    metadata.description = description;
  }

  // Publisher
  if (edition.publishers?.[0]) {
    metadata.publisher = edition.publishers[0];
  }

  // Release date
  if (edition.publish_date) {
    const isoDate = parseOLDate(edition.publish_date);
    if (isoDate) {
      metadata.releaseDate = isoDate;
    }
  }

  // Series (fallback chain: edition → work → subjects)
  const seriesInfo = extractSeries(edition, work);
  if (seriesInfo.series) {
    metadata.series = seriesInfo.series;
    if (seriesInfo.seriesNumber) {
      metadata.seriesNumber = seriesInfo.seriesNumber;
    }
  }

  // Genres and tags from subjects
  const { genres, tags } = parseSubjects(work.subjects);
  if (genres.length > 0) {
    metadata.genres = genres;
  }
  if (tags.length > 0) {
    metadata.tags = tags;
  }

  // Identifiers
  const identifiers = collectIdentifiers(edition, work);
  if (identifiers.length > 0) {
    metadata.identifiers = identifiers;
  }

  // Cover image
  const coverId = edition.covers?.[0] ?? work.covers?.[0];
  if (coverId) {
    shisho.log.info(`Fetching cover image: ${coverId}`);
    const coverData = fetchCover(coverId);
    if (coverData) {
      metadata.coverData = coverData;
      metadata.coverMimeType = "image/jpeg";
    }
  }

  return metadata;
}

/**
 * Extract series name and number from edition, work, or subjects.
 */
function extractSeries(
  edition: OLLookupResult["edition"],
  work: OLLookupResult["work"],
): { series?: string; seriesNumber?: number } {
  // Try edition series first
  if (edition.series?.[0]) {
    const series = edition.series[0];
    return {
      series,
      seriesNumber: parseSeriesNumber(series),
    };
  }

  // Try work series
  if (work.series?.[0]) {
    const series = work.series[0];
    return {
      series,
      seriesNumber: parseSeriesNumber(series),
    };
  }

  // Try subjects with "series:" prefix
  if (work.subjects) {
    for (const subject of work.subjects) {
      if (subject.toLowerCase().startsWith("series:")) {
        const series = toTitleCase(subject.slice(7).trim());
        return {
          series,
          seriesNumber: parseSeriesNumber(series),
        };
      }
    }
  }

  return {};
}

/**
 * Parse subjects into genres and tags.
 */
function parseSubjects(subjects?: string[]): {
  genres: string[];
  tags: string[];
} {
  const genres: string[] = [];
  const tags: string[] = [];

  if (!subjects) return { genres, tags };

  for (const subject of subjects) {
    if (subject.toLowerCase().startsWith("genre:")) {
      genres.push(toTitleCase(subject.slice(6).trim()));
    } else if (subject.toLowerCase().startsWith("series:")) {
      // Already handled in extractSeries
      continue;
    } else if (!subject.includes(":")) {
      // Regular tag (no prefix)
      tags.push(toTitleCase(subject));
    }
  }

  return { genres, tags };
}

/**
 * Collect all identifiers from edition and work.
 */
function collectIdentifiers(
  edition: OLLookupResult["edition"],
  work: OLLookupResult["work"],
): ParsedIdentifier[] {
  const identifiers: ParsedIdentifier[] = [];

  // Open Library work ID
  if (work.key) {
    identifiers.push({
      type: "openlibrary_work",
      value: extractOLId(work.key),
    });
  }

  // Open Library edition ID
  if (edition.key) {
    identifiers.push({
      type: "openlibrary_edition",
      value: extractOLId(edition.key),
    });
  }

  // ISBN-13
  for (const isbn of edition.isbn_13 ?? []) {
    identifiers.push({ type: "isbn_13", value: isbn });
  }

  // ISBN-10
  for (const isbn of edition.isbn_10 ?? []) {
    identifiers.push({ type: "isbn_10", value: isbn });
  }

  // Goodreads
  for (const goodreadsId of edition.identifiers?.goodreads ?? []) {
    identifiers.push({ type: "goodreads", value: goodreadsId });
  }

  return identifiers;
}
```

**Step 2: Verify build succeeds**

Run: `yarn build`
Expected: Build completes without errors

**Step 3: Commit**

```bash
git add plugins/open-library-enricher/src/mapping.ts
git commit -m "feat(open-library): add mapping module to transform OL data to ParsedMetadata"
```

---

## Task 6: Main Plugin Entry Point (index.ts)

**Files:**
- Modify: `plugins/open-library-enricher/src/index.ts`

**Step 1: Update index.ts to wire everything together**

```typescript
import type {
  EnrichmentResult,
  MetadataEnricherContext,
  ShishoPlugin,
} from "@shisho/plugin-types";

import { findBook } from "./lookup";
import { toMetadata } from "./mapping";

const plugin: ShishoPlugin = {
  metadataEnricher: {
    enrich(context: MetadataEnricherContext): EnrichmentResult {
      shisho.log.info("Open Library enricher starting");

      // Find the book using priority lookup chain
      const result = findBook(context);
      if (!result) {
        shisho.log.info("No match found in Open Library");
        return { modified: false };
      }

      // Transform to ParsedMetadata
      shisho.log.info(`Found: ${result.work.title}`);
      const metadata = toMetadata(result);

      return {
        modified: true,
        metadata,
      };
    },
  },
};
```

**Step 2: Verify build succeeds**

Run: `yarn build`
Expected: Build completes without errors

**Step 3: Verify lint passes**

Run: `yarn lint`
Expected: No errors or warnings

**Step 4: Commit**

```bash
git add plugins/open-library-enricher/src/index.ts
git commit -m "feat(open-library): complete plugin implementation with lookup and mapping"
```

---

## Task 7: Update Manifest with Custom Identifier Types

**Files:**
- Modify: `plugins/open-library-enricher/manifest.json`

**Step 1: Add custom identifier type declarations**

Update the manifest to declare the custom identifier types that will be returned:

```json
{
  "manifestVersion": 1,
  "id": "open-library-enricher",
  "name": "Open Library Enricher",
  "version": "0.1.0",
  "description": "Enriches book metadata from Open Library",
  "author": "Shisho Team",
  "homepage": "https://github.com/shishobooks/plugins",
  "license": "MIT",
  "capabilities": {
    "metadataEnricher": {
      "description": "Fetches metadata from Open Library API",
      "fileTypes": ["epub", "m4b"]
    },
    "httpAccess": {
      "description": "Calls Open Library API",
      "domains": ["openlibrary.org", "covers.openlibrary.org"]
    },
    "identifierTypes": [
      {
        "id": "openlibrary_work",
        "name": "Open Library Work",
        "urlTemplate": "https://openlibrary.org/works/{value}",
        "pattern": "^OL\\d+W$"
      },
      {
        "id": "openlibrary_edition",
        "name": "Open Library Edition",
        "urlTemplate": "https://openlibrary.org/books/{value}",
        "pattern": "^OL\\d+M$"
      }
    ]
  },
  "configSchema": {}
}
```

**Step 2: Verify build succeeds**

Run: `yarn build`
Expected: Build completes, manifest.json copied to dist

**Step 3: Commit**

```bash
git add plugins/open-library-enricher/manifest.json
git commit -m "feat(open-library): add custom identifier types to manifest"
```

---

## Task 8: Integration Test with Docker

**Step 1: Run the Docker test environment**

Run: `make test-docker`

This will start Shisho with the plugin loaded. The test environment should show the plugin being loaded successfully.

**Step 2: Verify plugin loads without errors**

Expected: Console output shows "Open Library Enricher" plugin loaded
Expected: No TypeScript or runtime errors

**Step 3: Test with a sample book**

If the test environment supports it, try enriching a book with a known ISBN to verify the lookup chain works.

---

## Task 9: Final Cleanup and Documentation

**Step 1: Run full lint check**

Run: `yarn lint`
Expected: No errors or warnings

**Step 2: Run build to ensure clean output**

Run: `yarn clean && yarn build`
Expected: Clean build with no warnings

**Step 3: Create final commit**

```bash
git add -A
git commit -m "chore(open-library): final cleanup and build verification"
```

---

## Summary of Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `src/utils.ts` | Create | Utility functions (Levenshtein, date parsing, etc.) |
| `src/types.ts` | Create | Open Library API response type definitions |
| `src/api.ts` | Create | HTTP API wrapper functions |
| `src/lookup.ts` | Create | Priority lookup chain (IDs → ISBN → search) |
| `src/mapping.ts` | Create | Transform OL responses to ParsedMetadata |
| `src/index.ts` | Modify | Wire together lookup and mapping |
| `manifest.json` | Modify | Add identifier types and covers subdomain |

## Architecture Diagram

```
                              ┌─────────────────────┐
                              │     index.ts        │
                              │   (entry point)     │
                              └──────────┬──────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
           ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
           │   lookup.ts    │   │   mapping.ts   │   │    utils.ts    │
           │ (find book)    │   │ (transform)    │   │ (helpers)      │
           └───────┬────────┘   └───────┬────────┘   └────────────────┘
                   │                    │
                   │                    │
                   ▼                    │
           ┌────────────────┐           │
           │    api.ts      │◄──────────┘
           │ (HTTP calls)   │
           └───────┬────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │   Open Library API   │
        │  openlibrary.org     │
        │  covers.openlibrary  │
        └──────────────────────┘
```
