import { fetchByISBN, fetchEdition, fetchWork, searchBooks } from "./api";
import type { OLEdition, OLSearchDoc, OLWork } from "./types";
import {
  extractOLId,
  levenshteinDistance,
  normalizeDescription,
  normalizeForComparison,
  parseOLDate,
} from "./utils";
import type { ParsedMetadata, SearchContext } from "@shisho/plugin-sdk";

const MAX_LEVENSHTEIN_DISTANCE = 5;
const MAX_LEVENSHTEIN_RATIO = 0.4;

/**
 * Search for candidate books in Open Library using the priority lookup chain:
 * 1. Existing Open Library IDs (edition or work)
 * 2. ISBN lookup
 * 3. Title + Author search (with confidence check)
 *
 * Returns lightweight ParsedMetadata[] for the user to select from.
 */
export function searchForBooks(context: SearchContext): ParsedMetadata[] {
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
 * Try search using existing Open Library identifiers.
 */
function tryExistingIdSearch(context: SearchContext): ParsedMetadata[] {
  const identifiers = context.identifiers ?? [];

  // Try edition ID first (more specific)
  const editionId = identifiers.find(
    (id) => id.type === "openlibrary_edition",
  )?.value;
  if (editionId) {
    shisho.log.info(`Looking up by edition ID: ${editionId}`);
    const edition = fetchEdition(editionId);
    if (edition) {
      const workId = edition.works?.[0]?.key
        ? extractOLId(edition.works[0].key)
        : undefined;
      // Search to find author names (not on edition endpoint)
      const search = searchBooks(edition.title);
      const matchingDoc = search?.docs.find(
        (doc) => workId && extractOLId(doc.key) === workId,
      );
      return [
        editionToResult(
          edition,
          { editionId, workId },
          matchingDoc?.author_name,
        ),
      ];
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
      // Search to find fields not on work endpoint (authors, publish year)
      const search = searchBooks(work.title);
      const matchingDoc = search?.docs.find(
        (doc) => extractOLId(doc.key) === workId,
      );
      return [workToResult(work, { workId }, matchingDoc)];
    }
  }

  return [];
}

/**
 * Try search using ISBN identifiers.
 */
function tryISBNSearch(context: SearchContext): ParsedMetadata[] {
  const identifiers = context.identifiers ?? [];

  // Try ISBN-13 first, then ISBN-10
  const isbns = identifiers
    .filter((id) => id.type === "isbn_13" || id.type === "isbn_10")
    .map((id) => id.value);

  for (const isbn of isbns) {
    shisho.log.info(`Looking up by ISBN: ${isbn}`);
    const edition = fetchByISBN(isbn);
    if (edition) {
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
        editionToResult(
          edition,
          { editionId, workId },
          matchingDoc?.author_name,
        ),
      ];
    }
  }

  return [];
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

  // Filter and convert matching results
  const results: ParsedMetadata[] = [];
  const normalizedTarget = normalizeForComparison(title);

  for (const doc of searchResult.docs) {
    const normalizedDoc = normalizeForComparison(doc.title);
    const distance = levenshteinDistance(normalizedTarget, normalizedDoc);

    const maxLen = Math.max(normalizedTarget.length, normalizedDoc.length);
    if (
      distance > MAX_LEVENSHTEIN_DISTANCE ||
      (maxLen > 0 && distance / maxLen > MAX_LEVENSHTEIN_RATIO)
    ) {
      continue;
    }

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

    const confidence = maxLen > 0 ? 1 - distance / maxLen : 1;
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
