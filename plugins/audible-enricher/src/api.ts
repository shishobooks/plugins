import {
  MARKETPLACE_DOMAINS,
  type AudibleProduct,
  type AudibleSearchResponse,
  type AudnexusBook,
} from "./types";

const USER_AGENT =
  "ShishoPlugin/0.1.0 (audible-enricher; github.com/shishobooks/plugins)";

const SEARCH_RESPONSE_GROUPS =
  "contributors,product_attrs,product_desc,product_extended_attrs,series,media,rating";

const PRODUCT_RESPONSE_GROUPS =
  "contributors,product_attrs,product_desc,product_extended_attrs,series,media,rating,category_ladders";

const IMAGE_SIZES = "500,1024";

function fetchJSON<T>(url: string): T | null {
  shisho.log.debug(`Fetching: ${url}`);
  const response = shisho.http.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!response || !response.ok) {
    shisho.log.warn(`HTTP ${response?.status ?? "no response"} for ${url}`);
    return null;
  }

  try {
    return response.json() as T;
  } catch {
    shisho.log.warn(`Failed to parse JSON from ${url}`);
    return null;
  }
}

/**
 * Parse the marketplace config into a validated list of marketplace codes.
 * Returns ["us"] if config is empty or missing.
 */
export function getMarketplaces(): string[] {
  const raw = shisho.config.get("marketplaces") as string | undefined;
  if (!raw) return ["us"];

  const codes = raw
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c in MARKETPLACE_DOMAINS);

  return codes.length > 0 ? codes : ["us"];
}

/**
 * Search Audible catalog by keywords, optionally filtered by author.
 */
export function searchProducts(
  marketplace: string,
  query: string,
  author?: string,
): AudibleProduct[] | null {
  const domain = MARKETPLACE_DOMAINS[marketplace];
  if (!domain) return null;

  const params: Record<string, string> = {
    keywords: query,
    num_results: "25",
    products_sort_by: "Relevance",
    response_groups: SEARCH_RESPONSE_GROUPS,
    image_sizes: IMAGE_SIZES,
  };
  if (author) {
    params.author = author;
  }

  const qs = shisho.url.searchParams(params);
  const data = fetchJSON<AudibleSearchResponse>(
    `https://${domain}/1.0/catalog/products?${qs}`,
  );
  return data?.products ?? null;
}

/**
 * Fetch a single product by ASIN (includes category_ladders for genres).
 */
export function fetchProduct(
  marketplace: string,
  asin: string,
): AudibleProduct | null {
  const domain = MARKETPLACE_DOMAINS[marketplace];
  if (!domain) return null;

  const params = shisho.url.searchParams({
    response_groups: PRODUCT_RESPONSE_GROUPS,
    image_sizes: IMAGE_SIZES,
  });
  const data = fetchJSON<{ product: AudibleProduct }>(
    `https://${domain}/1.0/catalog/products/${asin}?${params}`,
  );
  return data?.product ?? null;
}

/**
 * Fetch book metadata from Audnexus by ASIN.
 */
export function fetchAudnexusBook(
  asin: string,
  region: string,
): AudnexusBook | null {
  return fetchJSON<AudnexusBook>(
    `https://api.audnex.us/books/${asin}?region=${region}`,
  );
}
