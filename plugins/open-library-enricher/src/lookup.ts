import { fetchByISBN, fetchEdition, fetchWork, searchBooks } from "./api";
import type { OLEdition, OLSearchDoc, OLWork } from "./types";
import {
  extractOLId,
  normalizeDescription,
  normalizeForComparison,
  parseOLDate,
} from "./utils";
import { normalizeIsbn, titleMatchConfidence } from "@shisho-plugins/shared";
import type { ParsedMetadata, SearchContext } from "@shisho/plugin-sdk";

/**
 * Search for candidate books in Open Library using the priority lookup chain:
 * 1. Query-embedded identifier (OL URL / work ID / edition ID / ISBN) —
 *    wins over every file-metadata identifier and disables the title fallback.
 * 2. Existing file-metadata Open Library IDs (edition or work)
 * 3. File-metadata ISBN lookup
 * 4. Title + Author search (with confidence check)
 *
 * Returns lightweight ParsedMetadata[] for the user to select from.
 */
export function searchForBooks(context: SearchContext): ParsedMetadata[] {
  // A query-typed identifier trumps ALL file-metadata identifiers. If the
  // user pasted an Open Library URL/ID or an ISBN they're asking for a
  // specific book — honour that over whatever happens to be on the file,
  // and don't fall back to a fuzzy title search on a miss.
  const fromQuery = extractQueryIdentifiers(context.query ?? "");
  if (fromQuery.editionId) return lookupByEditionId(fromQuery.editionId);
  if (fromQuery.workId) return lookupByWorkId(fromQuery.workId);
  if (fromQuery.isbn) return lookupByIsbn(fromQuery.isbn);

  // 1. Try existing Open Library IDs
  const idResults = tryExistingIdSearch(context);
  if (idResults.length > 0) return idResults;

  // 2. Try ISBN lookup
  const isbnResults = tryISBNSearch(context);
  if (isbnResults.length > 0) return isbnResults;

  // 3. Try title + author search
  return tryTitleAuthorSearch(context);
}

/**
 * Parse a free-text query for a directly-usable identifier. Users often
 * paste an Open Library URL, OL ID, or ISBN into the title field when they
 * want a specific book.
 */
export function extractQueryIdentifiers(query: string): {
  editionId?: string;
  workId?: string;
  isbn?: string;
} {
  const trimmed = query.trim();
  if (!trimmed) return {};

  // Open Library URLs — /books/<edition>, /works/<work>, /isbn/<isbn>.
  // The ID is bounded by a path/query/fragment delimiter or end-of-string
  // so a trailing slug is ignored and a malformed ID isn't truncated.
  const editionUrl = trimmed.match(
    /openlibrary\.org\/books\/(OL\d+M)(?:[/?#]|$)/i,
  );
  if (editionUrl) return { editionId: editionUrl[1].toUpperCase() };

  const workUrl = trimmed.match(
    /openlibrary\.org\/works\/(OL\d+W)(?:[/?#]|$)/i,
  );
  if (workUrl) return { workId: workUrl[1].toUpperCase() };

  const isbnUrl = trimmed.match(/openlibrary\.org\/isbn\/([\dX-]+)/i);
  if (isbnUrl) {
    const normalized = normalizeIsbn(isbnUrl[1]);
    if (normalized) return { isbn: normalized };
  }

  // Bare OL identifiers — edition IDs end in M, work IDs in W.
  if (/^OL\d+M$/i.test(trimmed)) return { editionId: trimmed.toUpperCase() };
  if (/^OL\d+W$/i.test(trimmed)) return { workId: trimmed.toUpperCase() };

  // Bare ISBN, tolerant of dashes/spaces and a trailing X checksum.
  const normalizedIsbn = normalizeIsbn(trimmed);
  if (normalizedIsbn) return { isbn: normalizedIsbn };

  return {};
}

/**
 * Try search using existing file-metadata Open Library identifiers.
 */
function tryExistingIdSearch(context: SearchContext): ParsedMetadata[] {
  const identifiers = context.identifiers ?? [];

  // Try edition ID first (more specific)
  const editionId = identifiers.find(
    (id) => id.type === "openlibrary_edition",
  )?.value;
  if (editionId) {
    const results = lookupByEditionId(editionId);
    if (results.length > 0) return results;
  }

  // Try work ID
  const workId = identifiers.find(
    (id) => id.type === "openlibrary_work",
  )?.value;
  if (workId) {
    const results = lookupByWorkId(workId);
    if (results.length > 0) return results;
  }

  return [];
}

/**
 * Direct lookup by Open Library edition ID.
 */
function lookupByEditionId(editionId: string): ParsedMetadata[] {
  shisho.log.info(`Looking up by edition ID: ${editionId}`);
  const edition = fetchEdition(editionId);
  if (!edition) return [];

  const workId = edition.works?.[0]?.key
    ? extractOLId(edition.works[0].key)
    : undefined;
  // Search to find author names (not on edition endpoint)
  const search = searchBooks(edition.title);
  const matchingDoc = search?.docs.find(
    (doc) => workId && extractOLId(doc.key) === workId,
  );
  return [
    editionToResult(edition, { editionId, workId }, matchingDoc?.author_name),
  ];
}

/**
 * Direct lookup by Open Library work ID.
 */
function lookupByWorkId(workId: string): ParsedMetadata[] {
  shisho.log.info(`Looking up by work ID: ${workId}`);
  const work = fetchWork(workId);
  if (!work) return [];

  // Search to find fields not on work endpoint (authors, publish year)
  const search = searchBooks(work.title);
  const matchingDoc = search?.docs.find(
    (doc) => extractOLId(doc.key) === workId,
  );
  return [workToResult(work, { workId }, matchingDoc)];
}

/**
 * Try search using file-metadata ISBN identifiers.
 */
function tryISBNSearch(context: SearchContext): ParsedMetadata[] {
  const identifiers = context.identifiers ?? [];

  // Try ISBN-13 first, then ISBN-10
  const isbns = identifiers
    .filter((id) => id.type === "isbn_13" || id.type === "isbn_10")
    .map((id) => id.value);

  for (const isbn of isbns) {
    const results = lookupByIsbn(isbn);
    if (results.length > 0) return results;
  }

  return [];
}

/**
 * Direct lookup by ISBN.
 */
function lookupByIsbn(isbn: string): ParsedMetadata[] {
  shisho.log.info(`Looking up by ISBN: ${isbn}`);
  const edition = fetchByISBN(isbn);
  if (!edition) return [];

  const workId = edition.works?.[0]?.key
    ? extractOLId(edition.works[0].key)
    : undefined;
  const editionId = extractOLId(edition.key);
  // Search to find author names (not on edition endpoint)
  const search = searchBooks(edition.title);
  const matchingDoc = search?.docs.find(
    (doc) => workId && extractOLId(doc.key) === workId,
  );
  return [
    editionToResult(edition, { editionId, workId }, matchingDoc?.author_name),
  ];
}

/**
 * Try search using title + author with confidence check.
 */
function tryTitleAuthorSearch(context: SearchContext): ParsedMetadata[] {
  const title = context.query;
  if (!title) {
    shisho.log.debug("No title available for search");
    return [];
  }

  // Get author name for search
  const authorName = context.author;

  shisho.log.info(
    `Searching by title: "${title}"${authorName ? ` author: "${authorName}"` : ""}`,
  );
  const searchResult = searchBooks(title, authorName);
  if (!searchResult || searchResult.numFound === 0) {
    shisho.log.debug("No search results found");
    return [];
  }

  // Preserve API relevance order; score via titleMatchConfidence so a
  // subtitle in either side (query or result) doesn't tank the score.
  const results: ParsedMetadata[] = [];

  for (const doc of searchResult.docs) {
    // If we have an author in context, require overlap
    if (authorName) {
      if (!doc.author_name) {
        shisho.log.debug(`Skipping "${doc.title}" - no author info to verify`);
        continue;
      }
      const hasAuthorMatch = doc.author_name.some(
        (docAuthor) =>
          normalizeForComparison(authorName) ===
          normalizeForComparison(docAuthor),
      );
      if (!hasAuthorMatch) {
        shisho.log.debug(`Skipping "${doc.title}" - no author match`);
        continue;
      }
    }

    const confidence = titleMatchConfidence(title, doc.title);
    results.push(searchDocToResult(doc, confidence));
  }

  return results;
}

/**
 * Convert an OL edition to a ParsedMetadata result.
 */
function editionToResult(
  edition: OLEdition,
  ids: { editionId?: string; workId?: string },
  authorNames?: string[],
): ParsedMetadata {
  const result: ParsedMetadata = {
    title: edition.title,
    confidence: 1.0,
  };
  if (authorNames && authorNames.length > 0) {
    result.authors = authorNames.map((name) => ({ name }));
  }
  if (edition.publishers?.[0]) {
    result.publisher = edition.publishers[0];
  }
  if (edition.publish_date) {
    const date = parseOLDate(edition.publish_date);
    if (date) result.releaseDate = date;
  }
  const identifiers: Array<{ type: string; value: string }> = [];
  if (ids.workId) {
    identifiers.push({ type: "openlibrary_work", value: ids.workId });
  }
  if (ids.editionId) {
    identifiers.push({
      type: "openlibrary_edition",
      value: ids.editionId,
    });
  }
  for (const isbn of edition.isbn_13 ?? []) {
    identifiers.push({ type: "isbn_13", value: isbn });
  }
  for (const isbn of edition.isbn_10 ?? []) {
    identifiers.push({ type: "isbn_10", value: isbn });
  }
  if (identifiers.length > 0) {
    result.identifiers = identifiers;
  }
  if (edition.covers?.[0]) {
    result.coverUrl = `https://covers.openlibrary.org/b/id/${edition.covers[0]}-L.jpg`;
  }
  if (ids.editionId) {
    result.url = `https://openlibrary.org/books/${ids.editionId}`;
  } else if (ids.workId) {
    result.url = `https://openlibrary.org/works/${ids.workId}`;
  }
  return result;
}

/**
 * Convert an OL work to a ParsedMetadata result.
 */
function workToResult(
  work: OLWork,
  ids: { workId: string },
  searchDoc?: OLSearchDoc,
): ParsedMetadata {
  const result: ParsedMetadata = {
    title: work.title,
    confidence: 1.0,
  };
  const description = normalizeDescription(work.description);
  if (description) {
    result.description = description;
  }
  if (searchDoc?.author_name) {
    result.authors = searchDoc.author_name.map((name) => ({ name }));
  }
  if (searchDoc?.first_publish_year) {
    result.releaseDate = `${searchDoc.first_publish_year}-01-01T00:00:00Z`;
  }
  const identifiers: Array<{ type: string; value: string }> = [];
  if (ids.workId) {
    identifiers.push({ type: "openlibrary_work", value: ids.workId });
  }
  if (identifiers.length > 0) {
    result.identifiers = identifiers;
  }
  if (work.covers?.[0]) {
    result.coverUrl = `https://covers.openlibrary.org/b/id/${work.covers[0]}-L.jpg`;
  }
  result.url = `https://openlibrary.org/works/${ids.workId}`;
  return result;
}

/**
 * Convert a search doc to a ParsedMetadata result.
 */
function searchDocToResult(
  doc: OLSearchDoc,
  confidence: number,
): ParsedMetadata {
  const workId = extractOLId(doc.key);
  const editionId = doc.edition_key?.[0];

  const result: ParsedMetadata = {
    title: doc.title,
    confidence,
  };
  if (doc.author_name) {
    result.authors = doc.author_name.map((name) => ({ name }));
  }
  const identifiers: Array<{ type: string; value: string }> = [];
  identifiers.push({ type: "openlibrary_work", value: workId });
  if (editionId) {
    identifiers.push({ type: "openlibrary_edition", value: editionId });
  }
  result.identifiers = identifiers;
  if (doc.first_publish_year) {
    result.releaseDate = `${doc.first_publish_year}-01-01T00:00:00Z`;
  }
  if (doc.cover_i) {
    result.coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  }
  result.url = `https://openlibrary.org/works/${workId}`;
  return result;
}
