import { parseQuery } from "./filename";
import { fetchSeries, searchSeries } from "./mangaupdates/api";
import {
  getLiveEnglishPublishers,
  seriesToMetadata,
} from "./mangaupdates/mapping";
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

    // Fast path: compare against search-result primary titles only. Fetch
    // the full series (for authors/publishers/categories) only when a
    // candidate matches.
    const fastResults = matchCandidates(
      candidates,
      normalizedTarget,
      parsed.volumeNumber,
      parsed.edition,
      true,
    );
    if (fastResults.length > 0) return fastResults;

    // Slow path: the search API response does NOT include associated
    // titles, so we missed any candidate that matches only by an alternate
    // title (e.g., MU's primary is a Japanese romaji with no English
    // substring). Fetch the full series for every candidate and re-check
    // — associated titles are included in the detail response.
    shisho.log.debug(
      `No fast-path matches for "${attempt}"; falling back to associated-title check`,
    );
    const slowResults = matchCandidates(
      candidates,
      normalizedTarget,
      parsed.volumeNumber,
      parsed.edition,
      false,
    );
    if (slowResults.length > 0) return slowResults;
  }

  return [];
}

/**
 * Common matching loop for both fast and slow paths.
 *
 * In the fast path (`fetchedMatchOnly=true`), confidence is computed from
 * the search-result record (primary title only). For matches we then fetch
 * the full series so the returned metadata has authors/publishers/etc.
 *
 * In the slow path (`fetchedMatchOnly=false`), every candidate is fetched
 * up-front so confidence sees associated titles too. A single fetch per
 * candidate is shared between the confidence check and metadata building.
 */
function matchCandidates(
  candidates: MUSeries[],
  normalizedTarget: string,
  volumeNumber: number | undefined,
  edition: string | undefined,
  fastPath: boolean,
): ParsedMetadata[] {
  const results: ParsedMetadata[] = [];

  for (const candidate of candidates) {
    if (fastPath) {
      const confidence = computeConfidence(normalizedTarget, candidate);
      if (confidence === null) continue;
      const fullSeries = fetchSeries(candidate.series_id);
      if (!fullSeries) continue;
      const metadata = buildMetadata(fullSeries, volumeNumber, edition);
      metadata.confidence = confidence;
      results.push(metadata);
    } else {
      const fullSeries = fetchSeries(candidate.series_id);
      if (!fullSeries) continue;
      const confidence = computeConfidence(normalizedTarget, fullSeries);
      if (confidence === null) continue;
      const metadata = buildMetadata(fullSeries, volumeNumber, edition);
      metadata.confidence = confidence;
      results.push(metadata);
    }
  }

  return results;
}

/** Minimum target length to accept a substring match (avoid matching "the"). */
const MIN_SUBSTRING_LENGTH = 4;

/**
 * Compute a confidence score for a search result against the target query.
 * Returns null if no title passes any threshold.
 *
 * Two strategies are tried for each candidate title (primary + associated):
 * 1. Substring containment — if the target is contained in the candidate
 *    (or vice versa), that's a strong signal even when edit distance is
 *    large. This handles titles like "Japanese Romaji: English Title"
 *    where the query matches only the English portion.
 * 2. Levenshtein distance — fallback for near-misses that aren't strict
 *    substrings (typos, punctuation differences).
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
    const maxLen = Math.max(normalizedTarget.length, normalized.length);
    const minLen = Math.min(normalizedTarget.length, normalized.length);

    let confidence: number | null = null;

    // Strategy 1: substring containment.
    if (
      normalizedTarget.length >= MIN_SUBSTRING_LENGTH &&
      minLen > 0 &&
      (normalized.includes(normalizedTarget) ||
        normalizedTarget.includes(normalized))
    ) {
      // Scale confidence by how much of the longer title the shorter one
      // covers, with a floor of 0.6 so substring hits always beat the
      // Levenshtein cutoff.
      confidence = 0.6 + 0.4 * (minLen / maxLen);
    } else {
      // Strategy 2: Levenshtein fallback.
      const distance = levenshteinDistance(normalizedTarget, normalized);
      if (
        distance <= MAX_LEVENSHTEIN_DISTANCE &&
        (maxLen === 0 || distance / maxLen <= MAX_LEVENSHTEIN_RATIO)
      ) {
        confidence = maxLen > 0 ? 1 - distance / maxLen : 1;
      }
    }

    if (
      confidence !== null &&
      (bestConfidence === null || confidence > bestConfidence)
    ) {
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
 * Find per-volume data by mapping MangaUpdates' English publisher list to
 * our scraper registry. Only live (non-defunct, non-expired) publishers
 * are considered, and each one is matched against the scrapers in turn.
 *
 * If the parsed query has an edition, publishers whose notes mention that
 * edition are tried first (e.g., "Yen Press (12 Collector's Edition Vols)"
 * wins for a query that parsed as "Collector's Edition").
 *
 * When MangaUpdates lists publishers we don't have scrapers for, we skip
 * the scrape entirely — there's no point asking Viz about a Yen Press
 * series. Only if there is NO English publisher at all do we fall back to
 * trying every registered scraper blindly.
 */
function findVolumeData(
  series: MUSeries,
  volumeNumber: number,
  edition: string | undefined,
): VolumeMetadata | null {
  const seriesTitle = series.title;
  const livePublishers = getLiveEnglishPublishers(series);

  // No English publisher info at all — we have nothing to route on, so
  // blind-try every scraper in registry order.
  if (livePublishers.length === 0) {
    for (const scraper of SCRAPERS) {
      const data = scraper.searchVolume(seriesTitle, volumeNumber, edition);
      if (data) return data;
    }
    return null;
  }

  // When an edition is specified, bubble publishers whose notes mention
  // that edition to the front of the list. This picks "Yen Press" over
  // "Chuang Yi" / "TokyoPop" for a Fruits Basket Collector's Edition query.
  const orderedPublishers = edition
    ? [
        ...livePublishers.filter((p) =>
          (p.notes ?? "").toLowerCase().includes(edition.toLowerCase()),
        ),
        ...livePublishers.filter(
          (p) => !(p.notes ?? "").toLowerCase().includes(edition.toLowerCase()),
        ),
      ]
    : livePublishers;

  // Walk the publishers in order, attempting each one's matching scraper.
  // The first successful scrape wins. If a publisher has no matching
  // scraper, we skip it rather than falling back to unrelated scrapers.
  for (const publisher of orderedPublishers) {
    const scraper = SCRAPERS.find((s) => s.matchPublisher(publisher.name));
    if (!scraper) continue;
    const data = scraper.searchVolume(seriesTitle, volumeNumber, edition);
    if (data) return data;
  }

  return null;
}

/**
 * Merge per-volume data into the (already series-level) metadata. The
 * volume data overrides series fields where it is more specific (title,
 * description, url) and adds new fields (releaseDate, imprint, isbn, subtitle).
 */
function mergeVolumeData(
  metadata: ParsedMetadata,
  volumeData: VolumeMetadata,
): void {
  if (volumeData.title) metadata.title = volumeData.title;
  if (volumeData.subtitle) metadata.subtitle = volumeData.subtitle;
  if (volumeData.description) metadata.description = volumeData.description;
  if (volumeData.releaseDate) metadata.releaseDate = volumeData.releaseDate;
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
