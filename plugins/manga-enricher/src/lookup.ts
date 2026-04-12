import { parseQuery } from "./filename";
import { fetchSeries, searchSeries } from "./mangaupdates/api";
import { pickEnglishPublisher, seriesToMetadata } from "./mangaupdates/mapping";
import type { MUSeries } from "./mangaupdates/types";
import { kodanshaScraper } from "./publishers/kodansha";
import type { PublisherScraper, VolumeMetadata } from "./publishers/types";
import { vizScraper } from "./publishers/viz";
import {
  levenshteinDistance,
  normalizeForComparison,
} from "@shisho-plugins/shared";
import type {
  ParsedIdentifier,
  ParsedMetadata,
  SearchContext,
} from "@shisho/plugin-sdk";

const MAX_LEVENSHTEIN_DISTANCE = 5;
const MAX_LEVENSHTEIN_RATIO = 0.4;

/** Registry of publisher scrapers. Order matters for the fallback path. */
const SCRAPERS: readonly PublisherScraper[] = [vizScraper, kodanshaScraper];

/**
 * Main entry point. Returns candidate manga metadata for the given context.
 */
export function searchForManga(context: SearchContext): ParsedMetadata[] {
  // Tier 1: direct ID lookup.
  const idResults = tryIdLookup(context);
  if (idResults.length > 0) return idResults;

  // Tier 2: title search (with prefix fallback).
  return tryTitleSearch(context);
}

function tryIdLookup(context: SearchContext): ParsedMetadata[] {
  const id = context.identifiers?.find(
    (i) => i.type === "mangaupdates_series",
  )?.value;
  if (!id) return [];

  const seriesId = parseInt(id, 10);
  if (!Number.isFinite(seriesId)) return [];

  shisho.log.info(`Looking up MangaUpdates series ${seriesId}`);
  const series = fetchSeries(seriesId);
  if (!series) return [];

  const parsed = parseQuery(context.query);
  const metadata = buildMetadata(series, parsed.volumeNumber, parsed.edition);
  metadata.confidence = 1.0;
  return [metadata];
}

function tryTitleSearch(context: SearchContext): ParsedMetadata[] {
  const parsed = parseQuery(context.query);
  if (!parsed.seriesTitle) {
    shisho.log.debug("Empty series title after parsing query");
    return [];
  }

  shisho.log.info(
    `Searching MangaUpdates: "${parsed.seriesTitle}"${
      parsed.volumeNumber !== undefined ? ` vol ${parsed.volumeNumber}` : ""
    }${parsed.edition ? ` (${parsed.edition})` : ""}`,
  );

  // Build the list of attempts. Start with the full parsed title; if it
  // contains " - ", also try just the prefix. Each attempt is a separate
  // search query with its own Levenshtein target — this is what makes the
  // prefix fallback actually useful (otherwise candidates matching only
  // "Demon Slayer" would fail when compared against the full "Demon Slayer
  // - Kimetsu no Yaiba" target).
  const attempts: string[] = [parsed.seriesTitle];
  if (parsed.seriesTitle.includes(" - ")) {
    const prefix = parsed.seriesTitle.split(" - ")[0].trim();
    if (prefix && prefix !== parsed.seriesTitle) attempts.push(prefix);
  }

  for (const attempt of attempts) {
    const candidates = searchSeries(attempt);
    if (!candidates || candidates.length === 0) continue;

    const normalizedTarget = normalizeForComparison(attempt);
    const results: ParsedMetadata[] = [];

    for (const candidate of candidates) {
      const confidence = computeConfidence(normalizedTarget, candidate);
      if (confidence === null) continue;

      // Fetch the full series record to get authors/publishers/categories
      // which search results don't include.
      const fullSeries = fetchSeries(candidate.series_id);
      if (!fullSeries) continue;

      const metadata = buildMetadata(
        fullSeries,
        parsed.volumeNumber,
        parsed.edition,
      );
      metadata.confidence = confidence;
      results.push(metadata);
    }

    if (results.length > 0) return results;
  }

  return [];
}

/**
 * Compute a Levenshtein-based confidence score for a search result.
 * Returns null if the result fails the distance/ratio thresholds.
 * Checks both the primary title and associated titles and takes the best.
 */
function computeConfidence(
  normalizedTarget: string,
  candidate: MUSeries,
): number | null {
  const candidateTitles = [candidate.title];
  if (candidate.associated) {
    for (const a of candidate.associated) {
      if (a.title) candidateTitles.push(a.title);
    }
  }

  let bestConfidence: number | null = null;

  for (const title of candidateTitles) {
    const normalized = normalizeForComparison(title);
    const distance = levenshteinDistance(normalizedTarget, normalized);
    const maxLen = Math.max(normalizedTarget.length, normalized.length);

    if (
      distance > MAX_LEVENSHTEIN_DISTANCE ||
      (maxLen > 0 && distance / maxLen > MAX_LEVENSHTEIN_RATIO)
    ) {
      continue;
    }

    const confidence = maxLen > 0 ? 1 - distance / maxLen : 1;
    if (bestConfidence === null || confidence > bestConfidence) {
      bestConfidence = confidence;
    }
  }

  return bestConfidence;
}

/**
 * Build the final ParsedMetadata by combining MangaUpdates series data
 * and (if available) per-volume data from a publisher scraper.
 */
function buildMetadata(
  series: MUSeries,
  volumeNumber: number | undefined,
  edition: string | undefined,
): ParsedMetadata {
  const metadata = seriesToMetadata(series);

  if (volumeNumber !== undefined) {
    metadata.seriesNumber = volumeNumber;
  }

  if (volumeNumber !== undefined) {
    const volumeData = findVolumeData(series, volumeNumber, edition);
    if (volumeData) mergeVolumeData(metadata, volumeData);
  }

  return metadata;
}

/**
 * Find per-volume data by trying the routed publisher scraper first, then
 * falling back to all other scrapers in order.
 */
function findVolumeData(
  series: MUSeries,
  volumeNumber: number,
  edition: string | undefined,
): VolumeMetadata | null {
  const publisherName = pickEnglishPublisher(series);
  const seriesTitle = series.title;

  // Primary route: the scraper whose matchPublisher() agrees.
  let primary: PublisherScraper | undefined;
  if (publisherName) {
    primary = SCRAPERS.find((s) => s.matchPublisher(publisherName));
  }

  if (primary) {
    const data = primary.searchVolume(seriesTitle, volumeNumber, edition);
    if (data) return data;
  }

  // Fallback: try all other scrapers.
  for (const scraper of SCRAPERS) {
    if (scraper === primary) continue;
    const data = scraper.searchVolume(seriesTitle, volumeNumber, edition);
    if (data) return data;
  }

  return null;
}

/**
 * Merge per-volume data into the (already series-level) metadata. The
 * volume data overrides series fields where it is more specific (title,
 * description, url) and adds new fields (releaseDate, pageCount, imprint,
 * isbn, subtitle).
 */
function mergeVolumeData(
  metadata: ParsedMetadata,
  volumeData: VolumeMetadata,
): void {
  if (volumeData.title) metadata.title = volumeData.title;
  if (volumeData.subtitle) metadata.subtitle = volumeData.subtitle;
  if (volumeData.description) metadata.description = volumeData.description;
  if (volumeData.releaseDate) metadata.releaseDate = volumeData.releaseDate;
  if (volumeData.pageCount !== undefined)
    metadata.pageCount = volumeData.pageCount;
  if (volumeData.imprint) metadata.imprint = volumeData.imprint;
  if (volumeData.url) metadata.url = volumeData.url;

  const extraIdentifiers: ParsedIdentifier[] = [];
  if (volumeData.isbn13) {
    extraIdentifiers.push({ type: "isbn_13", value: volumeData.isbn13 });
  }
  if (volumeData.isbn10) {
    extraIdentifiers.push({ type: "isbn_10", value: volumeData.isbn10 });
  }
  if (extraIdentifiers.length > 0) {
    metadata.identifiers = [
      ...(metadata.identifiers ?? []),
      ...extraIdentifiers,
    ];
  }
}
