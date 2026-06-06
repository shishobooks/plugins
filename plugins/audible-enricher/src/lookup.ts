import {
  fetchAudnexusBook,
  fetchProduct,
  getMarketplaces,
  searchProducts,
} from "./api";
import { audibleToMetadata, audnexusToMetadata } from "./mapping";
import { MARKETPLACE_TLDS, type AudibleProduct } from "./types";
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
  if (fromQuery.asin) {
    // A pasted URL also tells us which store the book lives in. Try that
    // marketplace first, then fall back to the configured ones (so a UK-only
    // title from a .co.uk link still resolves even when `uk` isn't first).
    const ordered = preferMarketplace(fromQuery.marketplace, marketplaces);
    return lookupByAsin(fromQuery.asin, ordered);
  }

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
export function extractQueryIdentifiers(query: string): {
  asin?: string;
  marketplace?: string;
} {
  const trimmed = query.trim();
  if (!trimmed) return {};

  // Audible product URL — the ASIN is a path segment, e.g.
  // audible.com/pd/Project-Hail-Mary-Audiobook/B08G9PRS1K?ref=…
  // The captured TLD (com, co.uk, com.au, …) tells us which store the book
  // lives in, so we can look it up against the right marketplace first.
  const urlMatch = trimmed.match(
    /audible\.([a-z.]+)\/[^\s]*?(B[A-Z0-9]{9})(?:[/?#]|$)/i,
  );
  if (urlMatch) {
    const result: { asin?: string; marketplace?: string } = {
      asin: urlMatch[2].toUpperCase(),
    };
    const marketplace = marketplaceForTld(urlMatch[1]);
    if (marketplace) result.marketplace = marketplace;
    return result;
  }

  // Bare ASIN: B + 9 alphanumerics. No store is implied.
  if (/^B[A-Z0-9]{9}$/i.test(trimmed)) return { asin: trimmed.toUpperCase() };

  return {};
}

/**
 * Reverse-map a website TLD (com, co.uk, com.au, …) to a marketplace code.
 * Matches the whole TLD segment exactly so that `com`, `com.au`, and `com.br`
 * don't collide. Returns undefined for an unrecognised store.
 */
function marketplaceForTld(tld: string): string | undefined {
  const normalized = tld.toLowerCase();
  for (const code of Object.keys(MARKETPLACE_TLDS)) {
    if (MARKETPLACE_TLDS[code] === normalized) return code;
  }
  return undefined;
}

/**
 * Put a preferred marketplace (e.g. one derived from a pasted URL) at the
 * front of the configured list, de-duplicated. A missing preference leaves
 * the configured order untouched.
 */
function preferMarketplace(
  preferred: string | undefined,
  configured: string[],
): string[] {
  const ordered = preferred ? [preferred, ...configured] : configured;
  const seen = new Set<string>();
  return ordered.filter((marketplace) => {
    if (seen.has(marketplace)) return false;
    seen.add(marketplace);
    return true;
  });
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
 * Direct lookup by ASIN across the given marketplaces in order.
 * Per marketplace: Audnexus first (single call with genres), Audible API as
 * fallback. Returns on the first marketplace that resolves — an ASIN only
 * exists in one store, so the rest are misses anyway.
 */
function lookupByAsin(asin: string, marketplaces: string[]): ParsedMetadata[] {
  shisho.log.info(`Looking up by ASIN: ${asin}`);

  for (const marketplace of marketplaces) {
    // Try Audnexus first
    const audnexusBook = fetchAudnexusBook(asin, marketplace);
    if (audnexusBook) {
      shisho.log.info(`Got metadata from Audnexus (${marketplace})`);
      const metadata = audnexusToMetadata(audnexusBook, marketplace);
      metadata.confidence = 1.0;
      return [metadata];
    }

    // Fallback to the Audible API for this marketplace
    shisho.log.debug(
      `Audnexus unavailable for ${marketplace}, falling back to Audible API`,
    );
    const product = fetchProduct(marketplace, asin);
    if (product) {
      const metadata = audibleToMetadata(product, marketplace);
      metadata.confidence = 1.0;
      return [metadata];
    }
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
