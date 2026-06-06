import {
  fetchAudnexusBook,
  fetchProduct,
  getMarketplaces,
  searchProducts,
} from "./api";
import { audibleToMetadata, audnexusToMetadata } from "./mapping";
import type { AudibleProduct } from "./types";
import { titleMatchConfidence } from "@shisho-plugins/shared";
import type { ParsedMetadata, SearchContext } from "@shisho/plugin-sdk";

/**
 * Search for candidate audiobooks.
 *
 * Priority:
 *   1. Query-embedded identifier (Audible URL / ASIN) — wins over every
 *      file-metadata identifier and disables the title fallback.
 *   2. File-metadata ASIN.
 *   3. Fuzzy title + author search.
 */
export function searchForBooks(context: SearchContext): ParsedMetadata[] {
  const marketplaces = getMarketplaces();

  // A query-typed identifier trumps ALL file-metadata identifiers. If the
  // user pasted an Audible URL or ASIN they're asking for a specific book —
  // honour that over whatever happens to be on the file, and don't fall
  // back to a fuzzy title search on a miss.
  const fromQuery = extractQueryIdentifiers(context.query ?? "");
  if (fromQuery.asin) return lookupByAsin(fromQuery.asin, marketplaces);

  // Tier 1: Try ASIN lookup
  const asinResults = tryASINLookup(context, marketplaces);
  if (asinResults.length > 0) return asinResults;

  // Tier 2: Title + author search
  return tryTitleAuthorSearch(context, marketplaces);
}

/**
 * Parse a free-text query for a directly-usable identifier. Users often
 * paste an Audible product URL or a bare ASIN into the title field when
 * they want a specific audiobook.
 *
 * Only ASINs are recognised — unlike the Goodreads/Open Library enrichers
 * there is no ISBN path, because the Audible and Audnexus APIs are
 * ASIN-only and have no ISBN lookup.
 */
export function extractQueryIdentifiers(query: string): { asin?: string } {
  const trimmed = query.trim();
  if (!trimmed) return {};

  // Audible product URL — the ASIN is a path segment, e.g.
  // audible.com/pd/Project-Hail-Mary-Audiobook/B08G9PRS1K?ref=…
  const urlMatch = trimmed.match(
    /audible\.[a-z.]+\/[^\s]*?(B[A-Z0-9]{9})(?:[/?#]|$)/i,
  );
  if (urlMatch) return { asin: urlMatch[1].toUpperCase() };

  // Bare ASIN: B + 9 alphanumerics.
  if (/^B[A-Z0-9]{9}$/i.test(trimmed)) return { asin: trimmed.toUpperCase() };

  return {};
}

/**
 * Try lookup by file-metadata ASIN identifier.
 */
function tryASINLookup(
  context: SearchContext,
  marketplaces: string[],
): ParsedMetadata[] {
  const asin = (context.identifiers ?? []).find(
    (id) => id.type === "asin",
  )?.value;
  if (!asin) return [];

  return lookupByAsin(asin, marketplaces);
}

/**
 * Direct lookup by ASIN.
 * Audnexus first (single call with genres), Audible API as fallback.
 */
function lookupByAsin(asin: string, marketplaces: string[]): ParsedMetadata[] {
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

  // Preserve API relevance order; score each result via titleMatchConfidence
  // which handles subtitle variants ("Yesteryear" vs "Yesteryear: A GMA …").
  const results: ParsedMetadata[] = [];

  for (const { product, marketplace } of candidates) {
    const metadata = audibleToMetadata(product, marketplace);
    metadata.confidence = titleMatchConfidence(title, product.title);

    // Enrich with Audnexus data (genres, tags, cover, series, identifiers)
    // Audnexus provides better series selection (primary vs first-in-array),
    // higher-res cover images, and ISBN identifiers not in the Audible API.
    const audnexusBook = fetchAudnexusBook(product.asin, marketplace);
    if (audnexusBook) {
      const enriched = audnexusToMetadata(audnexusBook, marketplace);
      if (enriched.genres) metadata.genres = enriched.genres;
      if (enriched.tags) metadata.tags = enriched.tags;
      if (enriched.coverUrl) metadata.coverUrl = enriched.coverUrl;
      if (enriched.series) {
        metadata.series = enriched.series;
        metadata.seriesNumber = enriched.seriesNumber;
      }
      if (enriched.identifiers) metadata.identifiers = enriched.identifiers;
    }

    results.push(metadata);
  }

  return results;
}
