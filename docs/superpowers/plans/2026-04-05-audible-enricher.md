# Audible Enricher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a metadata enricher plugin that fetches audiobook metadata from Audible's catalog API, supplemented by Audnexus for genres/tags.

**Architecture:** Follows existing plugin pattern (api → lookup → mapping → index). Audible catalog API for search and primary metadata (no auth needed). Audnexus for genre/tag enrichment and as a fast path for ASIN lookups. Multi-marketplace support via user config.

**Tech Stack:** TypeScript, esbuild IIFE bundle, vitest, `@shisho/plugin-sdk`, `@shisho-plugins/shared`

---

### Task 1: Scaffold plugin boilerplate

**Files:**
- Create: `plugins/audible-enricher/manifest.json`
- Create: `plugins/audible-enricher/package.json`
- Create: `plugins/audible-enricher/tsconfig.json`
- Create: `plugins/audible-enricher/CHANGELOG.md`

- [ ] **Step 1: Create manifest.json**

```json
{
  "manifestVersion": 1,
  "id": "audible-enricher",
  "name": "Audible Enricher",
  "version": "0.1.0",
  "description": "Enriches audiobook metadata from Audible and Audnexus",
  "minShishoVersion": "0.0.26",
  "author": "Shisho Team",
  "homepage": "https://github.com/shishobooks/plugins",
  "license": "MIT",
  "capabilities": {
    "metadataEnricher": {
      "description": "Fetches audiobook metadata from Audible catalog API and Audnexus",
      "fileTypes": ["m4b"],
      "fields": [
        "title",
        "subtitle",
        "authors",
        "narrators",
        "description",
        "publisher",
        "releaseDate",
        "series",
        "seriesNumber",
        "genres",
        "tags",
        "cover",
        "identifiers",
        "url"
      ]
    },
    "httpAccess": {
      "description": "Calls Audible catalog API, Audnexus API, and fetches cover images from Amazon CDN",
      "domains": [
        "api.audible.com",
        "api.audible.co.uk",
        "api.audible.de",
        "api.audible.fr",
        "api.audible.it",
        "api.audible.es",
        "api.audible.ca",
        "api.audible.com.au",
        "api.audible.in",
        "api.audible.co.jp",
        "api.audible.com.br",
        "api.audnex.us",
        "m.media-amazon.com"
      ]
    },
    "identifierTypes": [
      {
        "id": "asin",
        "name": "ASIN",
        "urlTemplate": "https://www.audible.com/pd/{value}",
        "pattern": "^(B[\\dA-Z]{9}|\\d{9}[\\dX])$"
      }
    ]
  },
  "configSchema": {
    "marketplaces": {
      "type": "string",
      "label": "Audible Marketplaces",
      "description": "Comma-separated list of marketplace codes to search, in priority order. Available: us, uk, de, fr, it, es, ca, au, in, jp, br",
      "default": "us"
    }
  }
}
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "@shisho-plugins/audible-enricher",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "@shisho-plugins/shared": "workspace:*"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create CHANGELOG.md**

```markdown
# Changelog

## [Unreleased]
```

- [ ] **Step 5: Run pnpm install to register the new workspace**

Run: `pnpm install`
Expected: lockfile updates, new workspace registered

- [ ] **Step 6: Verify build picks up the new plugin**

Run: `pnpm build`
Expected: output includes "Found 3 plugin(s): audible-enricher, goodreads-enricher, open-library-enricher" (order may vary). Build will fail because `src/index.ts` doesn't exist yet — that's expected.

- [ ] **Step 7: Commit**

```bash
git add plugins/audible-enricher/manifest.json plugins/audible-enricher/package.json plugins/audible-enricher/tsconfig.json plugins/audible-enricher/CHANGELOG.md pnpm-lock.yaml
git commit -m "[Init] Scaffold audible-enricher plugin boilerplate"
```

---

### Task 2: Types — Audible API and Audnexus response types

**Files:**
- Create: `plugins/audible-enricher/src/types.ts`

- [ ] **Step 1: Create types.ts with Audible API response types**

```typescript
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
    overall_distribution: { display_average_rating: number; num_ratings: number };
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
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm lint:types`
Expected: may fail because no `index.ts` yet — that's fine as long as `types.ts` itself has no errors. Check output for errors in `types.ts` specifically.

- [ ] **Step 3: Commit**

```bash
git add plugins/audible-enricher/src/types.ts
git commit -m "[Feat] Add Audible API and Audnexus response types"
```

---

### Task 3: API layer — HTTP functions for Audible and Audnexus

**Files:**
- Create: `plugins/audible-enricher/src/api.ts`
- Create: `plugins/audible-enricher/src/__tests__/api.test.ts`

- [ ] **Step 1: Write failing tests for api.ts**

```typescript
import {
  fetchAudnexusBook,
  fetchProduct,
  getMarketplaces,
  searchProducts,
} from "../api";
import { beforeEach, describe, expect, it, vi } from "vitest";

function mockFetch(response: {
  status: number;
  ok: boolean;
  body?: unknown;
}) {
  vi.mocked(shisho.http.fetch).mockReturnValue({
    status: response.status,
    statusText: response.ok ? "OK" : "Error",
    ok: response.ok,
    json: () => response.body,
    text: () => JSON.stringify(response.body ?? ""),
  } as ReturnType<typeof shisho.http.fetch>);
}

describe("getMarketplaces", () => {
  it("parses comma-separated config value", () => {
    vi.mocked(shisho.config.get).mockReturnValue("us,uk,de");
    expect(getMarketplaces()).toEqual(["us", "uk", "de"]);
  });

  it("trims whitespace from codes", () => {
    vi.mocked(shisho.config.get).mockReturnValue("us , uk , de");
    expect(getMarketplaces()).toEqual(["us", "uk", "de"]);
  });

  it("filters out invalid marketplace codes", () => {
    vi.mocked(shisho.config.get).mockReturnValue("us,invalid,uk");
    expect(getMarketplaces()).toEqual(["us", "uk"]);
  });

  it("defaults to ['us'] when config is empty", () => {
    vi.mocked(shisho.config.get).mockReturnValue("");
    expect(getMarketplaces()).toEqual(["us"]);
  });

  it("defaults to ['us'] when config is undefined", () => {
    vi.mocked(shisho.config.get).mockReturnValue(undefined);
    expect(getMarketplaces()).toEqual(["us"]);
  });
});

describe("searchProducts", () => {
  it("returns products on success", () => {
    const products = [{ asin: "B08G9PRS1K", title: "Project Hail Mary" }];
    mockFetch({
      status: 200,
      ok: true,
      body: { products, total_results: 1 },
    });

    const result = searchProducts("us", "Project Hail Mary");
    expect(result).toEqual(products);
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      expect.stringContaining("api.audible.com/1.0/catalog/products?"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("includes author parameter when provided", () => {
    mockFetch({ status: 200, ok: true, body: { products: [] } });

    searchProducts("us", "Project Hail Mary", "Andy Weir");
    const url = vi.mocked(shisho.http.fetch).mock.calls[0][0] as string;
    expect(url).toContain("author=Andy+Weir");
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 503, ok: false });
    expect(searchProducts("us", "test")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    vi.mocked(shisho.http.fetch).mockReturnValue({
      status: 200,
      statusText: "OK",
      ok: true,
      json: () => {
        throw new Error("bad json");
      },
      text: () => "not json",
    } as ReturnType<typeof shisho.http.fetch>);

    expect(searchProducts("us", "test")).toBeNull();
  });

  it("uses correct domain for non-US marketplace", () => {
    mockFetch({ status: 200, ok: true, body: { products: [] } });

    searchProducts("uk", "test");
    const url = vi.mocked(shisho.http.fetch).mock.calls[0][0] as string;
    expect(url).toContain("api.audible.co.uk");
  });
});

describe("fetchProduct", () => {
  it("returns product on success", () => {
    const product = { asin: "B08G9PRS1K", title: "Project Hail Mary" };
    mockFetch({ status: 200, ok: true, body: { product } });

    const result = fetchProduct("us", "B08G9PRS1K");
    expect(result).toEqual(product);
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "api.audible.com/1.0/catalog/products/B08G9PRS1K?",
      ),
      expect.any(Object),
    );
  });

  it("includes category_ladders in response_groups", () => {
    mockFetch({ status: 200, ok: true, body: { product: {} } });

    fetchProduct("us", "B08G9PRS1K");
    const url = vi.mocked(shisho.http.fetch).mock.calls[0][0] as string;
    expect(url).toContain("category_ladders");
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 404, ok: false });
    expect(fetchProduct("us", "B08G9PRS1K")).toBeNull();
  });
});

describe("fetchAudnexusBook", () => {
  it("returns book on success", () => {
    const book = { asin: "B08G9PRS1K", title: "Project Hail Mary" };
    mockFetch({ status: 200, ok: true, body: book });

    const result = fetchAudnexusBook("B08G9PRS1K", "us");
    expect(result).toEqual(book);
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      "https://api.audnex.us/books/B08G9PRS1K?region=us",
      expect.any(Object),
    );
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 500, ok: false });
    expect(fetchAudnexusBook("B08G9PRS1K", "us")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- plugins/audible-enricher/src/__tests__/api.test.ts`
Expected: FAIL — module `../api` not found

- [ ] **Step 3: Implement api.ts**

```typescript
import type {
  AudibleProduct,
  AudibleSearchResponse,
  AudnexusBook,
} from "./types";
import { MARKETPLACE_DOMAINS } from "./types";

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- plugins/audible-enricher/src/__tests__/api.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/audible-enricher/src/api.ts plugins/audible-enricher/src/__tests__/api.test.ts
git commit -m "[Feat] Add Audible and Audnexus API layer with tests"
```

---

### Task 4: Mapping — transform API responses to ParsedMetadata

**Files:**
- Create: `plugins/audible-enricher/src/mapping.ts`
- Create: `plugins/audible-enricher/src/__tests__/mapping.test.ts`

- [ ] **Step 1: Write failing tests for mapping.ts**

```typescript
import { audibleToMetadata, audnexusToMetadata, stripHTML } from "../mapping";
import type { AudibleProduct, AudnexusBook } from "../types";
import { describe, expect, it } from "vitest";

function makeAudibleProduct(
  overrides: Partial<AudibleProduct> = {},
): AudibleProduct {
  return {
    asin: "B08G9PRS1K",
    title: "Project Hail Mary",
    ...overrides,
  };
}

function makeAudnexusBook(
  overrides: Partial<AudnexusBook> = {},
): AudnexusBook {
  return {
    asin: "B08G9PRS1K",
    title: "Project Hail Mary",
    authors: [{ name: "Andy Weir" }],
    narrators: [{ name: "Ray Porter" }],
    ...overrides,
  };
}

describe("audibleToMetadata", () => {
  it("maps all fields from a full product", () => {
    const product = makeAudibleProduct({
      subtitle: "A Novel",
      authors: [{ name: "Andy Weir" }],
      narrators: [{ name: "Ray Porter" }],
      publisher_name: "Audible Studios",
      publisher_summary: "<p>Ryland Grace is the sole survivor.</p>",
      release_date: "2021-05-04",
      series: [{ title: "Hail Mary", sequence: "1" }],
      product_images: {
        "500": "https://m.media-amazon.com/images/I/500.jpg",
        "1024": "https://m.media-amazon.com/images/I/1024.jpg",
      },
      category_ladders: [
        {
          ladder: [
            { id: "1", name: "Science Fiction & Fantasy" },
            { id: "2", name: "Science Fiction" },
          ],
          root: "Genres",
        },
      ],
    });

    const metadata = audibleToMetadata(product, "us");

    expect(metadata.title).toBe("Project Hail Mary");
    expect(metadata.subtitle).toBe("A Novel");
    expect(metadata.authors).toEqual([{ name: "Andy Weir" }]);
    expect(metadata.narrators).toEqual(["Ray Porter"]);
    expect(metadata.publisher).toBe("Audible Studios");
    expect(metadata.description).toBe("Ryland Grace is the sole survivor.");
    expect(metadata.releaseDate).toBe("2021-05-04T00:00:00Z");
    expect(metadata.series).toBe("Hail Mary");
    expect(metadata.seriesNumber).toBe(1);
    expect(metadata.coverUrl).toBe(
      "https://m.media-amazon.com/images/I/1024.jpg",
    );
    expect(metadata.genres).toEqual(["Science Fiction"]);
    expect(metadata.url).toBe(
      "https://www.audible.com/pd/B08G9PRS1K",
    );
    expect(metadata.identifiers).toEqual([
      { type: "asin", value: "B08G9PRS1K" },
    ]);
  });

  it("handles minimal product", () => {
    const product = makeAudibleProduct();
    const metadata = audibleToMetadata(product, "us");

    expect(metadata.title).toBe("Project Hail Mary");
    expect(metadata.identifiers).toEqual([
      { type: "asin", value: "B08G9PRS1K" },
    ]);
    expect(metadata.subtitle).toBeUndefined();
    expect(metadata.authors).toBeUndefined();
    expect(metadata.narrators).toBeUndefined();
  });

  it("prefers 1024 image over 500", () => {
    const product = makeAudibleProduct({
      product_images: {
        "500": "https://m.media-amazon.com/images/I/500.jpg",
        "1024": "https://m.media-amazon.com/images/I/1024.jpg",
      },
    });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.coverUrl).toBe(
      "https://m.media-amazon.com/images/I/1024.jpg",
    );
  });

  it("falls back to 500 image when 1024 is missing", () => {
    const product = makeAudibleProduct({
      product_images: {
        "500": "https://m.media-amazon.com/images/I/500.jpg",
      },
    });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.coverUrl).toBe(
      "https://m.media-amazon.com/images/I/500.jpg",
    );
  });

  it("extracts leaf genres from category_ladders", () => {
    const product = makeAudibleProduct({
      category_ladders: [
        {
          ladder: [
            { id: "1", name: "Science Fiction & Fantasy" },
            { id: "2", name: "Science Fiction" },
          ],
          root: "Genres",
        },
        {
          ladder: [
            { id: "3", name: "Literature & Fiction" },
            { id: "4", name: "Humor" },
          ],
          root: "Genres",
        },
      ],
    });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.genres).toEqual(["Science Fiction", "Humor"]);
  });

  it("parses fractional series number", () => {
    const product = makeAudibleProduct({
      series: [{ title: "Discworld", sequence: "2.5" }],
    });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.seriesNumber).toBe(2.5);
  });

  it("handles missing series sequence", () => {
    const product = makeAudibleProduct({
      series: [{ title: "Discworld" }],
    });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.series).toBe("Discworld");
    expect(metadata.seriesNumber).toBeUndefined();
  });

  it("constructs URL with correct TLD for non-US marketplace", () => {
    const product = makeAudibleProduct();
    const metadata = audibleToMetadata(product, "uk");
    expect(metadata.url).toBe(
      "https://www.audible.co.uk/pd/B08G9PRS1K",
    );
  });

  it("parses ISO date format", () => {
    const product = makeAudibleProduct({ release_date: "2021-05-04" });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.releaseDate).toBe("2021-05-04T00:00:00Z");
  });

  it("falls back to issue_date when release_date is missing", () => {
    const product = makeAudibleProduct({
      release_date: undefined,
      issue_date: "2021-05-04",
    });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.releaseDate).toBe("2021-05-04T00:00:00Z");
  });
});

describe("audnexusToMetadata", () => {
  it("maps all fields from a full response", () => {
    const book = makeAudnexusBook({
      subtitle: "A Novel",
      publisherName: "Audible Studios",
      summary: "<p>Ryland Grace is the sole survivor.</p>",
      releaseDate: "2021-05-04",
      image: "https://m.media-amazon.com/images/I/cover.jpg",
      seriesPrimary: { name: "Hail Mary", position: "1" },
      genres: [
        { asin: "1", name: "Science Fiction", type: "genre" },
        { asin: "2", name: "Space Opera", type: "tag" },
        { asin: "3", name: "First Contact", type: "tag" },
      ],
    });

    const metadata = audnexusToMetadata(book, "us");

    expect(metadata.title).toBe("Project Hail Mary");
    expect(metadata.subtitle).toBe("A Novel");
    expect(metadata.authors).toEqual([{ name: "Andy Weir" }]);
    expect(metadata.narrators).toEqual(["Ray Porter"]);
    expect(metadata.publisher).toBe("Audible Studios");
    expect(metadata.description).toBe("Ryland Grace is the sole survivor.");
    expect(metadata.releaseDate).toBe("2021-05-04T00:00:00Z");
    expect(metadata.series).toBe("Hail Mary");
    expect(metadata.seriesNumber).toBe(1);
    expect(metadata.coverUrl).toBe(
      "https://m.media-amazon.com/images/I/cover.jpg",
    );
    expect(metadata.genres).toEqual(["Science Fiction"]);
    expect(metadata.tags).toEqual(["Space Opera", "First Contact"]);
    expect(metadata.url).toBe(
      "https://www.audible.com/pd/B08G9PRS1K",
    );
    expect(metadata.identifiers).toEqual([
      { type: "asin", value: "B08G9PRS1K" },
    ]);
  });

  it("handles minimal response", () => {
    const book = makeAudnexusBook();
    const metadata = audnexusToMetadata(book, "us");

    expect(metadata.title).toBe("Project Hail Mary");
    expect(metadata.authors).toEqual([{ name: "Andy Weir" }]);
    expect(metadata.narrators).toEqual(["Ray Porter"]);
    expect(metadata.genres).toBeUndefined();
    expect(metadata.tags).toBeUndefined();
  });

  it("separates genres and tags by type field", () => {
    const book = makeAudnexusBook({
      genres: [
        { asin: "1", name: "Fantasy", type: "genre" },
        { asin: "2", name: "Epic", type: "tag" },
        { asin: "3", name: "Adventure", type: "genre" },
      ],
    });
    const metadata = audnexusToMetadata(book, "us");
    expect(metadata.genres).toEqual(["Fantasy", "Adventure"]);
    expect(metadata.tags).toEqual(["Epic"]);
  });

  it("parses fractional series position", () => {
    const book = makeAudnexusBook({
      seriesPrimary: { name: "Discworld", position: "2.5" },
    });
    const metadata = audnexusToMetadata(book, "us");
    expect(metadata.seriesNumber).toBe(2.5);
  });

  it("handles series with no position", () => {
    const book = makeAudnexusBook({
      seriesPrimary: { name: "Standalone" },
    });
    const metadata = audnexusToMetadata(book, "us");
    expect(metadata.series).toBe("Standalone");
    expect(metadata.seriesNumber).toBeUndefined();
  });
});

describe("stripHTML", () => {
  it("removes HTML tags", () => {
    expect(stripHTML("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("decodes HTML entities", () => {
    expect(stripHTML("one &amp; two")).toBe("one & two");
  });

  it("handles empty string", () => {
    expect(stripHTML("")).toBe("");
  });

  it("handles plain text", () => {
    expect(stripHTML("no tags here")).toBe("no tags here");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- plugins/audible-enricher/src/__tests__/mapping.test.ts`
Expected: FAIL — module `../mapping` not found

- [ ] **Step 3: Implement mapping.ts**

```typescript
import type { AudibleProduct, AudnexusBook } from "./types";
import { MARKETPLACE_TLDS } from "./types";
import type { ParsedMetadata } from "@shisho/plugin-sdk";

/**
 * Strip HTML tags and decode common HTML entities.
 */
export function stripHTML(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Parse a date string to ISO 8601 format.
 * Handles "YYYY-MM-DD" and "YYYY" formats.
 */
function toISODate(dateStr: string): string | undefined {
  if (!dateStr) return undefined;
  const trimmed = dateStr.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00Z`;
  }

  // YYYY
  if (/^\d{4}$/.test(trimmed)) {
    return `${trimmed}-01-01T00:00:00Z`;
  }

  return undefined;
}

/**
 * Build product URL for a given marketplace.
 */
function productUrl(asin: string, marketplace: string): string {
  const tld = MARKETPLACE_TLDS[marketplace] ?? "com";
  return `https://www.audible.${tld}/pd/${asin}`;
}

/**
 * Extract leaf genre names from Audible category_ladders.
 * Each ladder is a path from root to leaf; we take the last element.
 */
function extractGenres(
  ladders: AudibleProduct["category_ladders"],
): string[] | undefined {
  if (!ladders || ladders.length === 0) return undefined;

  const genres = ladders
    .map((l) => l.ladder[l.ladder.length - 1]?.name)
    .filter((name): name is string => !!name);

  return genres.length > 0 ? genres : undefined;
}

/**
 * Parse a series sequence string to a number.
 * Handles integers ("1") and fractional ("2.5").
 */
function parseSequence(seq: string | undefined): number | undefined {
  if (!seq) return undefined;
  const n = parseFloat(seq);
  return isNaN(n) ? undefined : n;
}

/**
 * Transform an Audible catalog API product to ParsedMetadata.
 */
export function audibleToMetadata(
  product: AudibleProduct,
  marketplace: string,
): ParsedMetadata {
  const metadata: ParsedMetadata = {};

  metadata.title = product.title;

  if (product.subtitle) {
    metadata.subtitle = product.subtitle;
  }

  if (product.authors && product.authors.length > 0) {
    metadata.authors = product.authors.map((a) => ({ name: a.name }));
  }

  if (product.narrators && product.narrators.length > 0) {
    metadata.narrators = product.narrators.map((n) => n.name);
  }

  if (product.publisher_name) {
    metadata.publisher = product.publisher_name;
  }

  if (product.publisher_summary) {
    metadata.description = stripHTML(product.publisher_summary);
  }

  const dateStr = product.release_date ?? product.issue_date;
  if (dateStr) {
    const isoDate = toISODate(dateStr);
    if (isoDate) {
      metadata.releaseDate = isoDate;
    }
  }

  if (product.series && product.series.length > 0) {
    const primary = product.series[0];
    metadata.series = primary.title;
    const num = parseSequence(primary.sequence);
    if (num !== undefined) {
      metadata.seriesNumber = num;
    }
  }

  const coverUrl =
    product.product_images?.["1024"] ?? product.product_images?.["500"];
  if (coverUrl) {
    metadata.coverUrl = coverUrl;
  }

  metadata.genres = extractGenres(product.category_ladders);

  metadata.url = productUrl(product.asin, marketplace);
  metadata.identifiers = [{ type: "asin", value: product.asin }];

  return metadata;
}

/**
 * Transform an Audnexus book response to ParsedMetadata.
 */
export function audnexusToMetadata(
  book: AudnexusBook,
  marketplace: string,
): ParsedMetadata {
  const metadata: ParsedMetadata = {};

  metadata.title = book.title;

  if (book.subtitle) {
    metadata.subtitle = book.subtitle;
  }

  if (book.authors.length > 0) {
    metadata.authors = book.authors.map((a) => ({ name: a.name }));
  }

  if (book.narrators.length > 0) {
    metadata.narrators = book.narrators.map((n) => n.name);
  }

  if (book.publisherName) {
    metadata.publisher = book.publisherName;
  }

  if (book.summary) {
    metadata.description = stripHTML(book.summary);
  }

  if (book.releaseDate) {
    const isoDate = toISODate(book.releaseDate);
    if (isoDate) {
      metadata.releaseDate = isoDate;
    }
  }

  if (book.seriesPrimary) {
    metadata.series = book.seriesPrimary.name;
    const num = parseSequence(book.seriesPrimary.position);
    if (num !== undefined) {
      metadata.seriesNumber = num;
    }
  }

  if (book.image) {
    metadata.coverUrl = book.image;
  }

  if (book.genres && book.genres.length > 0) {
    const genres = book.genres
      .filter((g) => g.type === "genre")
      .map((g) => g.name);
    const tags = book.genres
      .filter((g) => g.type === "tag")
      .map((g) => g.name);

    if (genres.length > 0) metadata.genres = genres;
    if (tags.length > 0) metadata.tags = tags;
  }

  metadata.url = productUrl(book.asin, marketplace);
  metadata.identifiers = [{ type: "asin", value: book.asin }];

  return metadata;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- plugins/audible-enricher/src/__tests__/mapping.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/audible-enricher/src/mapping.ts plugins/audible-enricher/src/__tests__/mapping.test.ts
git commit -m "[Feat] Add Audible/Audnexus metadata mapping with tests"
```

---

### Task 5: Lookup — search strategy with marketplace iteration and deduplication

**Files:**
- Create: `plugins/audible-enricher/src/lookup.ts`
- Create: `plugins/audible-enricher/src/__tests__/lookup.test.ts`

- [ ] **Step 1: Write failing tests for lookup.ts**

```typescript
import {
  fetchAudnexusBook,
  fetchProduct,
  getMarketplaces,
  searchProducts,
} from "../api";
import { searchForBooks } from "../lookup";
import type { AudibleProduct, AudnexusBook } from "../types";
import type { SearchContext } from "@shisho/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  getMarketplaces: vi.fn(),
  searchProducts: vi.fn(),
  fetchProduct: vi.fn(),
  fetchAudnexusBook: vi.fn(),
}));

const mockedGetMarketplaces = vi.mocked(getMarketplaces);
const mockedSearchProducts = vi.mocked(searchProducts);
const mockedFetchProduct = vi.mocked(fetchProduct);
const mockedFetchAudnexusBook = vi.mocked(fetchAudnexusBook);

function makeContext(overrides: Partial<SearchContext> = {}): SearchContext {
  return { query: "", ...overrides };
}

const sampleProduct: AudibleProduct = {
  asin: "B08G9PRS1K",
  title: "Project Hail Mary",
  subtitle: "A Novel",
  authors: [{ name: "Andy Weir" }],
  narrators: [{ name: "Ray Porter" }],
  publisher_name: "Audible Studios",
  publisher_summary: "Ryland Grace is the sole survivor.",
  release_date: "2021-05-04",
  series: [{ title: "Hail Mary", sequence: "1" }],
  product_images: { "1024": "https://m.media-amazon.com/images/I/cover.jpg" },
};

const sampleAudnexusBook: AudnexusBook = {
  asin: "B08G9PRS1K",
  title: "Project Hail Mary",
  authors: [{ name: "Andy Weir" }],
  narrators: [{ name: "Ray Porter" }],
  publisherName: "Audible Studios",
  summary: "Ryland Grace is the sole survivor.",
  releaseDate: "2021-05-04",
  image: "https://m.media-amazon.com/images/I/cover.jpg",
  seriesPrimary: { name: "Hail Mary", position: "1" },
  genres: [
    { asin: "1", name: "Science Fiction", type: "genre" },
    { asin: "2", name: "Space Opera", type: "tag" },
  ],
};

function setupDefaultMocks() {
  mockedGetMarketplaces.mockReturnValue(["us"]);
  mockedFetchAudnexusBook.mockReturnValue(null);
  mockedFetchProduct.mockReturnValue(null);
  mockedSearchProducts.mockReturnValue(null);
}

describe("searchForBooks", () => {
  describe("Tier 1: ASIN lookup", () => {
    it("tries Audnexus first when ASIN is available", () => {
      setupDefaultMocks();
      mockedFetchAudnexusBook.mockReturnValue(sampleAudnexusBook);

      const context = makeContext({
        identifiers: [{ type: "asin", value: "B08G9PRS1K" }],
      });

      const results = searchForBooks(context);

      expect(mockedFetchAudnexusBook).toHaveBeenCalledWith("B08G9PRS1K", "us");
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
      expect(results[0].title).toBe("Project Hail Mary");
      expect(results[0].genres).toEqual(["Science Fiction"]);
      expect(results[0].tags).toEqual(["Space Opera"]);
    });

    it("falls back to Audible API when Audnexus fails", () => {
      setupDefaultMocks();
      mockedFetchAudnexusBook.mockReturnValue(null);
      mockedFetchProduct.mockReturnValue(sampleProduct);

      const context = makeContext({
        identifiers: [{ type: "asin", value: "B08G9PRS1K" }],
      });

      const results = searchForBooks(context);

      expect(mockedFetchAudnexusBook).toHaveBeenCalled();
      expect(mockedFetchProduct).toHaveBeenCalledWith("us", "B08G9PRS1K");
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
    });

    it("returns empty when both Audnexus and Audible API fail for ASIN", () => {
      setupDefaultMocks();

      const context = makeContext({
        identifiers: [{ type: "asin", value: "B08G9PRS1K" }],
      });

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("skips non-ASIN identifiers", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([]);

      const context = makeContext({
        query: "Test",
        identifiers: [{ type: "isbn_13", value: "9780593135204" }],
      });

      searchForBooks(context);
      expect(mockedFetchAudnexusBook).not.toHaveBeenCalled();
      expect(mockedFetchProduct).not.toHaveBeenCalled();
    });
  });

  describe("Tier 2: Title + Author search", () => {
    it("searches across all configured marketplaces", () => {
      setupDefaultMocks();
      mockedGetMarketplaces.mockReturnValue(["us", "uk"]);
      mockedSearchProducts
        .mockReturnValueOnce([sampleProduct])
        .mockReturnValueOnce([]);

      const context = makeContext({ query: "Project Hail Mary" });
      searchForBooks(context);

      expect(mockedSearchProducts).toHaveBeenCalledWith(
        "us",
        "Project Hail Mary",
        undefined,
      );
      expect(mockedSearchProducts).toHaveBeenCalledWith(
        "uk",
        "Project Hail Mary",
        undefined,
      );
    });

    it("includes author in search when available", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([sampleProduct]);

      const context = makeContext({
        query: "Project Hail Mary",
        author: "Andy Weir",
      });
      searchForBooks(context);

      expect(mockedSearchProducts).toHaveBeenCalledWith(
        "us",
        "Project Hail Mary",
        "Andy Weir",
      );
    });

    it("deduplicates results by ASIN across marketplaces", () => {
      setupDefaultMocks();
      mockedGetMarketplaces.mockReturnValue(["us", "uk"]);
      mockedSearchProducts
        .mockReturnValueOnce([sampleProduct])
        .mockReturnValueOnce([sampleProduct]);

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(results).toHaveLength(1);
    });

    it("filters out results with high Levenshtein distance", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([
        { ...sampleProduct, title: "A Completely Different Title Altogether" },
      ]);

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(results).toHaveLength(0);
    });

    it("computes confidence from Levenshtein distance", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([sampleProduct]);

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
    });

    it("tries Audnexus for genre enrichment on search results", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([sampleProduct]);
      mockedFetchAudnexusBook.mockReturnValue(sampleAudnexusBook);

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(mockedFetchAudnexusBook).toHaveBeenCalledWith(
        "B08G9PRS1K",
        "us",
      );
      expect(results[0].genres).toEqual(["Science Fiction"]);
      expect(results[0].tags).toEqual(["Space Opera"]);
    });

    it("still returns results when Audnexus genre enrichment fails", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([sampleProduct]);
      mockedFetchAudnexusBook.mockReturnValue(null);

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(results).toHaveLength(1);
      expect(results[0].genres).toBeUndefined();
    });

    it("returns empty when query is empty", () => {
      setupDefaultMocks();
      const context = makeContext({ query: "" });
      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("returns empty when search returns null", () => {
      setupDefaultMocks();
      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- plugins/audible-enricher/src/__tests__/lookup.test.ts`
Expected: FAIL — module `../lookup` not found

- [ ] **Step 3: Implement lookup.ts**

```typescript
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
 * Priority: ASIN lookup → Title + Author search
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- plugins/audible-enricher/src/__tests__/lookup.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/audible-enricher/src/lookup.ts plugins/audible-enricher/src/__tests__/lookup.test.ts
git commit -m "[Feat] Add Audible lookup strategy with marketplace iteration and Audnexus fallback"
```

---

### Task 6: Plugin entry point and integration

**Files:**
- Create: `plugins/audible-enricher/src/index.ts`

- [ ] **Step 1: Create index.ts**

```typescript
import { searchForBooks } from "./lookup";
import type {
  SearchContext,
  SearchResponse,
  ShishoPlugin,
} from "@shisho/plugin-sdk";

const plugin: ShishoPlugin = {
  metadataEnricher: {
    search(context: SearchContext): SearchResponse {
      shisho.log.info("Audible enricher: searching");

      const results = searchForBooks(context);
      shisho.log.info(`Found ${results.length} candidate(s)`);

      return { results };
    },
  },
};

// Export for esbuild IIFE bundling - this becomes the return value
export default plugin;
```

- [ ] **Step 2: Run the full build**

Run: `pnpm build`
Expected: "Found 3 plugin(s)" and "Built audible-enricher" in output. Check that `dist/audible-enricher/main.js` and `dist/audible-enricher/manifest.json` exist.

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: all tests pass across all plugins

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: no errors (eslint, prettier, types all pass)

- [ ] **Step 5: Commit**

```bash
git add plugins/audible-enricher/src/index.ts
git commit -m "[Feat] Add Audible enricher plugin entry point"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: all tests pass

- [ ] **Step 2: Run full lint**

Run: `pnpm lint`
Expected: all checks pass

- [ ] **Step 3: Run build and verify output**

Run: `pnpm build && ls -la dist/audible-enricher/`
Expected: `main.js` and `manifest.json` present in dist

- [ ] **Step 4: Verify manifest.json was copied to dist**

Run: `diff plugins/audible-enricher/manifest.json dist/audible-enricher/manifest.json`
Expected: no diff
