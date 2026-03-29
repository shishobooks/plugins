import { fetchCover } from "./api";
import type { OLLookupResult } from "./types";
import {
  extractOLId,
  normalizeDescription,
  parseOLDate,
  parseSeriesNumber,
  toTitleCase,
} from "./utils";
import type {
  ParsedAuthor,
  ParsedIdentifier,
  ParsedMetadata,
} from "@shisho/plugin-sdk";

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
    ?.filter(
      (c) =>
        c.role.toLowerCase().includes("narrator") ||
        c.role.toLowerCase().includes("reader"),
    )
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
    const cover = fetchCover(coverId);
    if (cover) {
      metadata.coverData = cover.data;
      metadata.coverMimeType = cover.mimeType;
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

  // Open Library edition ID (skip synthetic editions with empty/placeholder keys)
  if (edition.key && edition.key.includes("/")) {
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
