import {
  fetchAuthor,
  fetchByISBN,
  fetchEdition,
  fetchWork,
  searchBooks,
} from "./api";
import type {
  OLAuthor,
  OLEdition,
  OLLookupResult,
  OLSearchDoc,
  OLWork,
} from "./types";
import {
  extractOLId,
  levenshteinDistance,
  normalizeForComparison,
} from "./utils";
import type { MetadataEnricherContext } from "@shisho/plugin-types";

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
function tryISBNLookup(
  context: MetadataEnricherContext,
): OLLookupResult | null {
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
  const title = context.parsedMetadata.title ?? context.book.title;
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
        shisho.log.debug(`Skipping "${doc.title}" - no author match`);
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
  const matchingDoc = searchResult.docs.find(
    (doc) => doc.key === work.key || extractOLId(doc.key) === workId,
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
