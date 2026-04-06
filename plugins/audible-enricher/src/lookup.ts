import {
  fetchAudnexusBook,
  fetchProduct,
  getMarketplaces,
  searchProducts,
} from "./api";
import { audibleToMetadata, audnexusToMetadata } from "./mapping";
import type { AudibleProduct } from "./types";
import {
  levenshteinDistance,
  normalizeForComparison,
} from "@shisho-plugins/shared";
import type { ParsedMetadata, SearchContext } from "@shisho/plugin-sdk";

const MAX_LEVENSHTEIN_DISTANCE = 5;
const MAX_LEVENSHTEIN_RATIO = 0.4;

/**
 * Search for candidate audiobooks.
 * Priority: ASIN lookup -> Title + Author search
 */
export function searchForBooks(context: SearchContext): ParsedMetadata[] {
  const marketplaces = getMarketplaces();

  // Tier 1: Try ASIN lookup
  const asinResults = tryASINLookup(context, marketplaces);
  if (asinResults.length > 0) return asinResults;

  // Tier 2: Title + author search
  return tryTitleAuthorSearch(context, marketplaces);
}

/**
 * Try lookup by ASIN identifier.
 * Audnexus first (single call with genres), Audible API as fallback.
 */
function tryASINLookup(
  context: SearchContext,
  marketplaces: string[],
): ParsedMetadata[] {
  const asin = (context.identifiers ?? []).find(
    (id) => id.type === "asin",
  )?.value;
  if (!asin) return [];

  const primaryMarketplace = marketplaces[0];
  shisho.log.info(`Looking up by ASIN: ${asin}`);

  // Try Audnexus first
  const audnexusBook = fetchAudnexusBook(asin, primaryMarketplace);
  if (audnexusBook) {
    shisho.log.info("Got metadata from Audnexus");
    const metadata = audnexusToMetadata(audnexusBook, primaryMarketplace);
    metadata.confidence = 1.0;
    return [metadata];
  }

  // Fallback to Audible API
  shisho.log.debug("Audnexus unavailable, falling back to Audible API");
  const product = fetchProduct(primaryMarketplace, asin);
  if (product) {
    const metadata = audibleToMetadata(product, primaryMarketplace);
    metadata.confidence = 1.0;
    return [metadata];
  }

  return [];
}

/**
 * Search by title + author across all configured marketplaces.
 * Deduplicates by ASIN, filters by Levenshtein distance, enriches genres via Audnexus.
 */
function tryTitleAuthorSearch(
  context: SearchContext,
  marketplaces: string[],
): ParsedMetadata[] {
  const title = context.query;
  if (!title) {
    shisho.log.debug("No title available for search");
    return [];
  }

  const author = context.author;
  shisho.log.info(
    `Searching by title: "${title}"${author ? ` author: "${author}"` : ""}`,
  );

  // Search all marketplaces, collect products deduplicated by ASIN
  const seenAsins = new Set<string>();
  const candidates: Array<{ product: AudibleProduct; marketplace: string }> =
    [];

  for (const marketplace of marketplaces) {
    const products = searchProducts(marketplace, title, author);
    if (!products) continue;

    for (const product of products) {
      if (seenAsins.has(product.asin)) continue;
      seenAsins.add(product.asin);
      candidates.push({ product, marketplace });
    }
  }

  // Filter by Levenshtein distance and compute confidence
  const normalizedTarget = normalizeForComparison(title);
  const results: ParsedMetadata[] = [];

  for (const { product, marketplace } of candidates) {
    const normalizedResult = normalizeForComparison(product.title);
    const distance = levenshteinDistance(normalizedTarget, normalizedResult);
    const maxLen = Math.max(normalizedTarget.length, normalizedResult.length);

    if (
      distance > MAX_LEVENSHTEIN_DISTANCE ||
      (maxLen > 0 && distance / maxLen > MAX_LEVENSHTEIN_RATIO)
    ) {
      continue;
    }

    const confidence = maxLen > 0 ? 1 - distance / maxLen : 1;
    const metadata = audibleToMetadata(product, marketplace);
    metadata.confidence = confidence;

    // Try Audnexus for genre/tag enrichment
    const audnexusBook = fetchAudnexusBook(product.asin, marketplace);
    if (audnexusBook?.genres && audnexusBook.genres.length > 0) {
      const genres = audnexusBook.genres
        .filter((g) => g.type === "genre")
        .map((g) => g.name);
      const tags = audnexusBook.genres
        .filter((g) => g.type === "tag")
        .map((g) => g.name);

      if (genres.length > 0) metadata.genres = genres;
      if (tags.length > 0) metadata.tags = tags;
    }

    results.push(metadata);
  }

  return results;
}
