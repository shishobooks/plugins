/** Marketplace code to API domain mapping */
export const MARKETPLACE_DOMAINS: Record<string, string> = {
  us: "api.audible.com",
  uk: "api.audible.co.uk",
  de: "api.audible.de",
  fr: "api.audible.fr",
  it: "api.audible.it",
  es: "api.audible.es",
  ca: "api.audible.ca",
  au: "api.audible.com.au",
  in: "api.audible.in",
  jp: "api.audible.co.jp",
  br: "api.audible.com.br",
};

/** Marketplace code to website TLD mapping (for constructing product URLs) */
export const MARKETPLACE_TLDS: Record<string, string> = {
  us: "com",
  uk: "co.uk",
  de: "de",
  fr: "fr",
  it: "it",
  es: "es",
  ca: "ca",
  au: "com.au",
  in: "in",
  jp: "co.jp",
  br: "com.br",
};

// --- Audible Catalog API types ---

/** Single product from Audible catalog API */
export interface AudibleProduct {
  asin: string;
  title: string;
  subtitle?: string;
  authors?: Array<{ asin?: string; name: string }>;
  narrators?: Array<{ asin?: string; name: string }>;
  publisher_name?: string;
  publisher_summary?: string;
  merchandising_summary?: string;
  release_date?: string;
  issue_date?: string;
  runtime_length_min?: number;
  language?: string;
  format_type?: string;
  product_images?: Record<string, string>;
  series?: Array<{ asin?: string; title: string; sequence?: string }>;
  category_ladders?: Array<{
    ladder: Array<{ id: string; name: string }>;
    root: string;
  }>;
  rating?: {
    overall_distribution: {
      display_average_rating: number;
      num_ratings: number;
    };
  };
}

/** Audible catalog search response wrapper */
export interface AudibleSearchResponse {
  products: AudibleProduct[];
  response_groups: string[];
  total_results: number;
}

// --- Audnexus API types ---

/** Audnexus book response */
export interface AudnexusBook {
  asin: string;
  title: string;
  subtitle?: string;
  authors: Array<{ asin?: string; name: string }>;
  narrators: Array<{ asin?: string; name: string }>;
  publisherName?: string;
  summary?: string;
  releaseDate?: string;
  image?: string;
  genres?: Array<{ asin: string; name: string; type: string }>;
  seriesPrimary?: { asin?: string; name: string; position?: string };
  seriesSecondary?: { asin?: string; name: string; position?: string };
  language?: string;
  runtimeLengthMin?: number;
  formatType?: string;
  region?: string;
}
