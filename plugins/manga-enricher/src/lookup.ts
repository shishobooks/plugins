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
 * MangaUpdates series types to exclude from candidate matching.
 * These are fan works and ancillary materials that won't be on any
 * licensed English publisher's site and clutter results with false
 * substring matches.
 */
const EXCLUDED_SERIES_TYPES: ReadonlySet<string> = new Set(["doujinshi"]);

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
  const metadata = buildMetadata(
    series,
    parsed.volumeNumber,
    parsed.edition,
    parsed.seriesTitle || undefined,
  );
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
    const rawCandidates = searchSeries(attempt);
    if (!rawCandidates || rawCandidates.length === 0) continue;

    // Drop fan-work types (Doujinshi) — they clutter results with
    // substring-match false positives ("Fruits Basket" matching "Fruits
    // Basket dj - Gift") and are never licensed in English.
    const candidates = rawCandidates.filter(
      (c) => !EXCLUDED_SERIES_TYPES.has((c.type ?? "").toLowerCase()),
    );
    if (candidates.length === 0) continue;

    const normalizedTarget = normalizeForComparison(attempt);

    // Fast path: compare against search-result primary titles only. Fetch
    // the full series (for authors/publishers/categories) only when a
    // candidate matches.
    const fastResults = matchCandidates(
      candidates,
      normalizedTarget,
      parsed.volumeNumber,
      parsed.edition,
      parsed.seriesTitle,
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
      parsed.seriesTitle,
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
  searchTitle: string,
  fastPath: boolean,
): ParsedMetadata[] {
  const results: ParsedMetadata[] = [];

  for (const candidate of candidates) {
    if (fastPath) {
      const confidence = computeConfidence(normalizedTarget, candidate);
      if (confidence === null) continue;
      const fullSeries = fetchSeries(candidate.series_id);
      if (!fullSeries) continue;
      const metadata = buildMetadata(
        fullSeries,
        volumeNumber,
        edition,
        searchTitle,
      );
      metadata.confidence = confidence;
      results.push(metadata);
    } else {
      const fullSeries = fetchSeries(candidate.series_id);
      if (!fullSeries) continue;
      const confidence = computeConfidence(normalizedTarget, fullSeries);
      if (confidence === null) continue;
      const metadata = buildMetadata(
        fullSeries,
        volumeNumber,
        edition,
        searchTitle,
      );
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
 *
 * `searchTitle` is the title parsed from the user's query (typically the
 * filename). It's passed down to the publisher scraper so that series
 * whose MU primary is a Japanese romaji still slugify correctly — e.g.,
 * a user's "Sweat and Soap v01.cbz" reaches Kodansha as "sweat-and-soap"
 * instead of MU's "ase-to-sekken".
 */
function buildMetadata(
  series: MUSeries,
  volumeNumber: number | undefined,
  edition: string | undefined,
  searchTitle: string | undefined,
): ParsedMetadata {
  const metadata = seriesToMetadata(series);

  // Pick a canonical display title. We use the MangaUpdates title (from
  // the primary or associated-titles list) that's closest to the user's
  // query. This normalizes casing and punctuation to MU's canonical form
  // — "sweat and soap" becomes "Sweat and Soap", "attack on titan"
  // becomes "Attack on Titan" — while still respecting whichever language
  // variant the user typed (MU's associated-titles list usually contains
  // a near-exact match).
  if (searchTitle) {
    metadata.series = pickCanonicalTitle(series, searchTitle) ?? searchTitle;
  }

  if (volumeNumber !== undefined) {
    metadata.seriesNumber = volumeNumber;
  }

  if (volumeNumber !== undefined) {
    const scrapeResult = findVolumeData(
      series,
      volumeNumber,
      edition,
      searchTitle,
    );
    if (scrapeResult) {
      mergeVolumeData(metadata, scrapeResult.data);
      // The scraper that succeeded is the authoritative English publisher
      // for this volume — override whatever pickEnglishPublisher chose.
      metadata.publisher = scrapeResult.scraperName;
    }
  }

  // Standardize the title format to `{Series} v{NNN}` — Shisho's own
  // filename parser produces this shape, and publishers vary wildly
  // ("One Piece, Vol. 1", "Wotakoi Volume 1", "Attack on Titan 1"),
  // so we generate it ourselves rather than pass through whatever the
  // scraper returned.
  if (metadata.series) {
    metadata.title =
      metadata.seriesNumber !== undefined
        ? `${metadata.series} v${padVolumeNumber(metadata.seriesNumber)}`
        : metadata.series;
  }

  return metadata;
}

/**
 * Pick the canonical display title for a series by finding the MU
 * title (primary or associated) closest to the user's query under
 * normalized Levenshtein comparison. Returns the original (non-
 * normalized) form so casing and punctuation are preserved from MU's
 * canonical entry.
 *
 * We trust that confidence scoring has already confirmed this series
 * matches the query, so any MU title is a reasonable candidate — no
 * distance threshold is applied. In practice the associated-titles
 * list almost always contains a near-exact match for whichever
 * language variant the user typed, so the "best" choice is obvious.
 *
 * Ties on distance break to the shorter title — avoids variants like
 * "Attack on Titan: Junior High" winning over plain "Attack on Titan"
 * when both match equally.
 */
export function pickCanonicalTitle(
  series: MUSeries,
  query: string,
): string | undefined {
  if (!query) return undefined;

  const candidates: string[] = [];
  if (series.title) candidates.push(series.title);
  if (series.associated) {
    for (const a of series.associated) {
      if (a.title) candidates.push(a.title);
    }
  }
  if (candidates.length === 0) return undefined;

  const normalizedQuery = normalizeForComparison(query);

  let best: { title: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const normalized = normalizeForComparison(candidate);
    const distance = levenshteinDistance(normalizedQuery, normalized);

    if (
      best === null ||
      distance < best.distance ||
      (distance === best.distance && candidate.length < best.title.length)
    ) {
      best = { title: candidate, distance };
    }
  }

  return best?.title;
}

/**
 * Format a volume number as a 3-digit zero-padded string, preserving
 * any fractional part. 1 -> "001", 12 -> "012", 123 -> "123", 2.5 -> "002.5".
 */
function padVolumeNumber(n: number): string {
  if (Number.isInteger(n)) {
    return String(n).padStart(3, "0");
  }
  const [intPart, decPart] = String(n).split(".");
  return `${intPart.padStart(3, "0")}.${decPart}`;
}

/**
 * Find per-volume data by mapping MangaUpdates' English publisher list to
 * our scraper registry. Only live (non-defunct, non-expired) publishers
 * with a matching scraper are tried.
 *
 * The scraper is called with `searchTitle` (the user's filename-derived
 * title) when available, falling back to MU's primary title. MU's primary
 * is often a Japanese romaji ("Ase to Sekken") while the publisher site
 * uses the English title ("Sweat and Soap"). Since the user's filename is
 * almost always in English, trusting it gives us the right slug.
 *
 * If the parsed query has an edition, publishers whose notes mention that
 * edition are tried first (e.g., "Yen Press (12 Collector's Edition Vols)"
 * wins for a query that parsed as "Collector's Edition").
 *
 * When MangaUpdates lists no live supported publisher, we return null
 * rather than blindly pinging every scraper. A series MU doesn't know is
 * licensed by Viz or Kodansha will not show up on those sites; speculative
 * requests just produce 404 noise.
 */
/** Result of a successful publisher scrape. */
interface ScrapeResult {
  data: VolumeMetadata;
  /** Canonical name of the scraper that succeeded (e.g., "Kodansha USA"). */
  scraperName: string;
}

function findVolumeData(
  series: MUSeries,
  volumeNumber: number,
  edition: string | undefined,
  searchTitle: string | undefined,
): ScrapeResult | null {
  const seriesTitle = searchTitle ?? series.title;
  const livePublishers = getLiveEnglishPublishers(series);
  if (livePublishers.length === 0) return null;

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
    if (data) return { data, scraperName: scraper.name };
  }

  return null;
}

/**
 * Merge per-volume data into the (already series-level) metadata. Adds
 * or overrides fields with the scraper's per-volume values. Notably does
 * NOT touch `title` — buildMetadata standardizes the title format after
 * this runs, and publisher titles are too inconsistent ("Vol. 1" vs
 * "Volume 1" vs ", Vol. 1") to pass through verbatim.
 */
function mergeVolumeData(
  metadata: ParsedMetadata,
  volumeData: VolumeMetadata,
): void {
  if (volumeData.subtitle) metadata.subtitle = volumeData.subtitle;
  if (volumeData.description) metadata.description = volumeData.description;
  if (volumeData.releaseDate) metadata.releaseDate = volumeData.releaseDate;
  if (volumeData.imprint) metadata.imprint = volumeData.imprint;
  if (volumeData.url) metadata.url = volumeData.url;
  // Publisher cover (per-volume) overrides the series-level MU cover.
  if (volumeData.coverUrl) metadata.coverUrl = volumeData.coverUrl;

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
