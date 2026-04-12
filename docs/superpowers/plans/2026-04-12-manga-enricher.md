# Manga Enricher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a metadata enricher plugin for manga CBZ/CBR files that combines MangaUpdates (series-level metadata) with Viz Media and Kodansha USA publisher scraping (per-volume synopsis, release date, ISBN, page count).

**Architecture:** Follows the existing plugin pattern used by `open-library-enricher`, `goodreads-enricher`, and `audible-enricher` (api → lookup → mapping → index). A `filename.ts` module parses the search query (which for CBZ files is derived from the filename) to extract series title, volume number, and edition variant. A pluggable `publishers/` directory holds per-publisher scrapers that all implement a shared `PublisherScraper` interface — adding a new publisher (or a new language) is a new file plus registration in the scraper registry.

**Tech Stack:** TypeScript, esbuild IIFE bundle, vitest, `@shisho/plugin-sdk`, `@shisho-plugins/shared`

**Spec:** `docs/superpowers/specs/2026-04-12-manga-enricher-design.md`

---

### Task 1: Scaffold plugin boilerplate

**Files:**
- Create: `plugins/manga-enricher/manifest.json`
- Create: `plugins/manga-enricher/package.json`
- Create: `plugins/manga-enricher/tsconfig.json`
- Create: `plugins/manga-enricher/CHANGELOG.md`

- [ ] **Step 1: Create `plugins/manga-enricher/manifest.json`**

```json
{
  "manifestVersion": 1,
  "id": "manga-enricher",
  "name": "Manga Enricher",
  "version": "0.1.0",
  "description": "Enriches manga metadata from MangaUpdates and publisher websites (Viz, Kodansha USA)",
  "minShishoVersion": "0.0.28",
  "author": "Shisho Team",
  "homepage": "https://github.com/shishobooks/plugins",
  "license": "MIT",
  "capabilities": {
    "metadataEnricher": {
      "description": "Fetches manga metadata from MangaUpdates and scrapes per-volume details from Viz and Kodansha USA",
      "fileTypes": [
        "cbz",
        "cbr"
      ],
      "fields": [
        "title",
        "subtitle",
        "authors",
        "description",
        "publisher",
        "imprint",
        "releaseDate",
        "series",
        "seriesNumber",
        "genres",
        "tags",
        "identifiers",
        "url",
        "language",
        "pageCount"
      ]
    },
    "httpAccess": {
      "description": "Calls the MangaUpdates API and scrapes Viz Media and Kodansha USA product pages",
      "domains": [
        "api.mangaupdates.com",
        "www.viz.com",
        "kodansha.us"
      ]
    },
    "identifierTypes": [
      {
        "id": "mangaupdates_series",
        "name": "MangaUpdates Series",
        "urlTemplate": "https://www.mangaupdates.com/series.html?id={value}",
        "pattern": "^\\d+$"
      }
    ]
  },
  "configSchema": {}
}
```

- [ ] **Step 2: Create `plugins/manga-enricher/package.json`**

```json
{
  "name": "@shisho-plugins/manga-enricher",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "@shisho-plugins/shared": "workspace:*"
  }
}
```

- [ ] **Step 3: Create `plugins/manga-enricher/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `plugins/manga-enricher/CHANGELOG.md`**

```markdown
# Changelog

## [Unreleased]

### Features
- Manga metadata enricher plugin (MangaUpdates + Viz + Kodansha USA)
```

- [ ] **Step 5: Install the new workspace package**

Run: `pnpm install`
Expected: No errors; lockfile updates with the new workspace package.

- [ ] **Step 6: Commit**

```bash
git add plugins/manga-enricher pnpm-lock.yaml
git commit -m "[Feature] Scaffold manga-enricher plugin"
```

---

### Task 2: Query parser — extension and parenthesized noise stripping

**Files:**
- Create: `plugins/manga-enricher/src/filename.ts`
- Create: `plugins/manga-enricher/src/__tests__/filename.test.ts`

This task builds the foundation of `filename.ts` — it strips file extensions and trailing parenthesized metadata (year, digital, scan group). It does NOT yet extract volume numbers or editions — those come in Tasks 3 and 4.

- [ ] **Step 1: Write the failing test**

Create `plugins/manga-enricher/src/__tests__/filename.test.ts`:

```typescript
import { parseQuery } from "../filename";
import { describe, expect, it } from "vitest";

describe("parseQuery", () => {
  describe("extension and noise stripping", () => {
    it("strips a .cbz extension", () => {
      expect(parseQuery("One Piece.cbz").seriesTitle).toBe("One Piece");
    });

    it("strips a .cbr extension", () => {
      expect(parseQuery("One Piece.cbr").seriesTitle).toBe("One Piece");
    });

    it("handles strings without an extension", () => {
      expect(parseQuery("One Piece").seriesTitle).toBe("One Piece");
    });

    it("strips a single trailing parenthesized group", () => {
      expect(parseQuery("One Piece (2010)").seriesTitle).toBe("One Piece");
    });

    it("strips multiple trailing parenthesized groups", () => {
      expect(
        parseQuery("One Piece (2023) (Digital) (1r0n)").seriesTitle,
      ).toBe("One Piece");
    });

    it("strips noise that appears before the extension", () => {
      expect(
        parseQuery("One Piece (2023) (Digital) (1r0n).cbz").seriesTitle,
      ).toBe("One Piece");
    });

    it("trims trailing whitespace and dashes", () => {
      expect(parseQuery("One Piece - ").seriesTitle).toBe("One Piece");
    });

    it("returns an empty seriesTitle for an empty input", () => {
      expect(parseQuery("").seriesTitle).toBe("");
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: FAIL with "Cannot find module '../filename'" or similar.

- [ ] **Step 3: Create `plugins/manga-enricher/src/filename.ts`**

```typescript
/**
 * Parsed result of a manga search query (typically a filename-derived string).
 */
export interface ParsedQuery {
  /** The series title with noise stripped. */
  seriesTitle: string;
  /** The volume number if one could be extracted. */
  volumeNumber?: number;
  /** The edition variant if one was detected (e.g., "Collector's Edition"). */
  edition?: string;
}

/**
 * Parse a search query into its component parts.
 *
 * The query is typically derived from a filename by Shisho's scan pipeline.
 * We don't know exactly how clean or messy it will be, so the parser is
 * defensive: it handles already-clean titles and raw filename-like strings
 * uniformly.
 */
export function parseQuery(query: string): ParsedQuery {
  if (!query) return { seriesTitle: "" };

  let working = query;

  // 1. Strip a .cbz/.cbr extension if present.
  working = working.replace(/\.(cbz|cbr)$/i, "");

  // 2. Strip trailing parenthesized groups, repeatedly, from right to left.
  //    e.g. "Foo v01 (2023) (Digital) (1r0n)" -> "Foo v01"
  while (true) {
    const stripped = working.replace(/\s*\([^()]*\)\s*$/, "");
    if (stripped === working) break;
    working = stripped;
  }

  // 3. Clean up trailing whitespace, dashes, and hyphens.
  working = working.replace(/[\s\-–—]+$/, "").trim();

  return { seriesTitle: working };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: PASS (all tests in the `extension and noise stripping` describe block).

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/filename.ts plugins/manga-enricher/src/__tests__/filename.test.ts
git commit -m "[Feature] Query parser: extension and noise stripping"
```

---

### Task 3: Query parser — volume number extraction

**Files:**
- Modify: `plugins/manga-enricher/src/filename.ts`
- Modify: `plugins/manga-enricher/src/__tests__/filename.test.ts`

- [ ] **Step 1: Add failing tests for volume extraction**

Append to `plugins/manga-enricher/src/__tests__/filename.test.ts`, inside `describe("parseQuery", ...)` and after the existing inner describe:

```typescript
  describe("volume number extraction", () => {
    it("extracts v01 style", () => {
      const result = parseQuery("Bleach v01 (2021).cbz");
      expect(result.seriesTitle).toBe("Bleach");
      expect(result.volumeNumber).toBe(1);
    });

    it("extracts v03 style", () => {
      const result = parseQuery("Chihayafuru v03 (2017).cbz");
      expect(result.seriesTitle).toBe("Chihayafuru");
      expect(result.volumeNumber).toBe(3);
    });

    it("extracts 'Vol. 03' style", () => {
      const result = parseQuery("Some Manga Vol. 03.cbz");
      expect(result.seriesTitle).toBe("Some Manga");
      expect(result.volumeNumber).toBe(3);
    });

    it("extracts 'Volume 001' style", () => {
      const result = parseQuery("20th Century Boys - Volume 001.cbr");
      expect(result.seriesTitle).toBe("20th Century Boys");
      expect(result.volumeNumber).toBe(1);
    });

    it("extracts '#001' style", () => {
      const result = parseQuery("Bakuman #001 (2010).cbz");
      expect(result.seriesTitle).toBe("Bakuman");
      expect(result.volumeNumber).toBe(1);
    });

    it("does not treat a 4-digit trailing number as a volume", () => {
      // A bare 4-digit number is more likely to be a year than a volume.
      const result = parseQuery("Some Series 2023.cbz");
      expect(result.volumeNumber).toBeUndefined();
    });

    it("extracts a bare trailing 2-3 digit number as last resort", () => {
      const result = parseQuery("Some Series 003.cbz");
      expect(result.seriesTitle).toBe("Some Series");
      expect(result.volumeNumber).toBe(3);
    });

    it("leaves volumeNumber undefined when none is present", () => {
      const result = parseQuery("One Piece.cbz");
      expect(result.volumeNumber).toBeUndefined();
    });

    it("removes the volume marker from the series title", () => {
      const result = parseQuery("Chained Soldier v01 (2022) (Digital).cbz");
      expect(result.seriesTitle).toBe("Chained Soldier");
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: FAIL — the new tests fail because `volumeNumber` is never set and the series title still contains the volume marker.

- [ ] **Step 3: Implement volume extraction in `filename.ts`**

Replace the entire body of `parseQuery` in `plugins/manga-enricher/src/filename.ts` with:

```typescript
export function parseQuery(query: string): ParsedQuery {
  if (!query) return { seriesTitle: "" };

  let working = query;

  // 1. Strip a .cbz/.cbr extension if present.
  working = working.replace(/\.(cbz|cbr)$/i, "");

  // 2. Strip trailing parenthesized groups, repeatedly, from right to left.
  while (true) {
    const stripped = working.replace(/\s*\([^()]*\)\s*$/, "");
    if (stripped === working) break;
    working = stripped;
  }

  // 3. Extract a volume number. Try explicit markers first, then a bare
  //    trailing number as a last resort (restricted to 2-3 digits to avoid
  //    matching years).
  let volumeNumber: number | undefined;
  const volumePatterns: RegExp[] = [
    /\s*[Vv](\d+)\b\s*$/, // "v01", "v1"
    /\s*[Vv]ol(?:ume)?\.?\s*(\d+)\b\s*$/, // "Vol. 03", "Volume 001"
    /\s*#(\d+)\b\s*$/, // "#001"
    /\s(\d{2,3})$/, // trailing 2-3 digit number
  ];

  for (const pattern of volumePatterns) {
    const match = working.match(pattern);
    if (match) {
      volumeNumber = parseInt(match[1], 10);
      working = working.slice(0, match.index).trimEnd();
      break;
    }
  }

  // 4. Clean up trailing whitespace, dashes, and hyphens.
  working = working.replace(/[\s\-–—]+$/, "").trim();

  return {
    seriesTitle: working,
    volumeNumber,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: PASS (all tests in both describe blocks).

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/filename.ts plugins/manga-enricher/src/__tests__/filename.test.ts
git commit -m "[Feature] Query parser: extract volume numbers"
```

---

### Task 4: Query parser — edition variant detection

**Files:**
- Modify: `plugins/manga-enricher/src/filename.ts`
- Modify: `plugins/manga-enricher/src/__tests__/filename.test.ts`

- [ ] **Step 1: Add failing tests for edition detection**

Append a new describe block inside `describe("parseQuery", ...)` in `plugins/manga-enricher/src/__tests__/filename.test.ts`:

```typescript
  describe("edition variant detection", () => {
    it("detects Collector's Edition", () => {
      const result = parseQuery(
        "Fruits Basket Collector's Edition v01 (2016).cbz",
      );
      expect(result.seriesTitle).toBe("Fruits Basket");
      expect(result.edition).toBe("Collector's Edition");
      expect(result.volumeNumber).toBe(1);
    });

    it("detects Omnibus Edition", () => {
      const result = parseQuery("One Piece Omnibus Edition v05 (2020).cbz");
      expect(result.seriesTitle).toBe("One Piece");
      expect(result.edition).toBe("Omnibus Edition");
      expect(result.volumeNumber).toBe(5);
    });

    it("detects bare Omnibus", () => {
      const result = parseQuery("Some Series Omnibus v02.cbz");
      expect(result.seriesTitle).toBe("Some Series");
      expect(result.edition).toBe("Omnibus");
    });

    it("detects Deluxe Edition", () => {
      const result = parseQuery("Berserk Deluxe Edition v01.cbz");
      expect(result.seriesTitle).toBe("Berserk");
      expect(result.edition).toBe("Deluxe Edition");
    });

    it("detects Fullmetal Edition", () => {
      const result = parseQuery("Fullmetal Alchemist Fullmetal Edition v01.cbz");
      expect(result.seriesTitle).toBe("Fullmetal Alchemist");
      expect(result.edition).toBe("Fullmetal Edition");
    });

    it("detects 3-in-1 Edition", () => {
      const result = parseQuery("Naruto 3-in-1 Edition v01.cbz");
      expect(result.seriesTitle).toBe("Naruto");
      expect(result.edition).toBe("3-in-1 Edition");
    });

    it("detects Digital Colored Comics", () => {
      const result = parseQuery(
        "Bleach - Digital Colored Comics v01 (2021).cbz",
      );
      expect(result.seriesTitle).toBe("Bleach");
      expect(result.edition).toBe("Digital Colored Comics");
    });

    it("leaves edition undefined when none is present", () => {
      const result = parseQuery("One Piece v01.cbz");
      expect(result.edition).toBeUndefined();
    });

    it("is case-insensitive", () => {
      const result = parseQuery("some series OMNIBUS EDITION v01.cbz");
      expect(result.edition).toBe("Omnibus Edition");
      expect(result.seriesTitle).toBe("some series");
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: FAIL — the new tests fail because edition detection isn't implemented.

- [ ] **Step 3: Implement edition detection in `filename.ts`**

Replace the entire file `plugins/manga-enricher/src/filename.ts` with:

```typescript
/**
 * Parsed result of a manga search query (typically a filename-derived string).
 */
export interface ParsedQuery {
  /** The series title with noise stripped. */
  seriesTitle: string;
  /** The volume number if one could be extracted. */
  volumeNumber?: number;
  /** The edition variant if one was detected (e.g., "Collector's Edition"). */
  edition?: string;
}

/**
 * Known edition variant keywords. Order matters: more specific multi-word
 * phrases must come before their shorter prefixes (e.g., "Omnibus Edition"
 * before "Omnibus", "Deluxe Edition" before "Deluxe").
 */
const EDITION_VARIANTS: readonly string[] = [
  "Collector's Edition",
  "Omnibus Edition",
  "Omnibus",
  "Box Set",
  "Deluxe Edition",
  "Deluxe",
  "3-in-1 Edition",
  "2-in-1 Edition",
  "Master Edition",
  "Perfect Edition",
  "Complete Edition",
  "Fullmetal Edition",
  "Digital Colored Comics",
  "Full Color Edition",
];

/**
 * Escape a string for use inside a regular expression.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a search query into its component parts.
 *
 * The query is typically derived from a filename by Shisho's scan pipeline.
 * We don't know exactly how clean or messy it will be, so the parser is
 * defensive: it handles already-clean titles and raw filename-like strings
 * uniformly.
 */
export function parseQuery(query: string): ParsedQuery {
  if (!query) return { seriesTitle: "" };

  let working = query;

  // 1. Strip a .cbz/.cbr extension if present.
  working = working.replace(/\.(cbz|cbr)$/i, "");

  // 2. Strip trailing parenthesized groups, repeatedly, from right to left.
  while (true) {
    const stripped = working.replace(/\s*\([^()]*\)\s*$/, "");
    if (stripped === working) break;
    working = stripped;
  }

  // 3. Extract a volume number. Try explicit markers first, then a bare
  //    trailing number as a last resort (restricted to 2-3 digits to avoid
  //    matching years).
  let volumeNumber: number | undefined;
  const volumePatterns: RegExp[] = [
    /\s*[Vv](\d+)\b\s*$/,
    /\s*[Vv]ol(?:ume)?\.?\s*(\d+)\b\s*$/,
    /\s*#(\d+)\b\s*$/,
    /\s(\d{2,3})$/,
  ];
  for (const pattern of volumePatterns) {
    const match = working.match(pattern);
    if (match) {
      volumeNumber = parseInt(match[1], 10);
      working = working.slice(0, match.index).trimEnd();
      break;
    }
  }

  // 4. Detect edition variants by searching the remaining trailing portion
  //    (case-insensitive). Longer variants come first so they win.
  let edition: string | undefined;
  for (const variant of EDITION_VARIANTS) {
    const regex = new RegExp(
      `[\\s\\-–—]+${escapeRegExp(variant)}\\s*$`,
      "i",
    );
    const match = working.match(regex);
    if (match) {
      edition = variant;
      working = working.slice(0, match.index).trimEnd();
      break;
    }
  }

  // 5. Clean up trailing whitespace, dashes, and hyphens.
  working = working.replace(/[\s\-–—]+$/, "").trim();

  return {
    seriesTitle: working,
    volumeNumber,
    edition,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: PASS (all tests across all three describe blocks).

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/filename.ts plugins/manga-enricher/src/__tests__/filename.test.ts
git commit -m "[Feature] Query parser: detect edition variants"
```

---

### Task 5: MangaUpdates types and API client

**Files:**
- Create: `plugins/manga-enricher/src/mangaupdates/types.ts`
- Create: `plugins/manga-enricher/src/mangaupdates/api.ts`
- Create: `plugins/manga-enricher/src/__tests__/mangaupdates-api.test.ts`

- [ ] **Step 1: Create `plugins/manga-enricher/src/mangaupdates/types.ts`**

```typescript
/**
 * A single series record from MangaUpdates — used by both search and
 * the series detail endpoint. Search returns a subset of these fields.
 */
export interface MUSeries {
  series_id: number;
  title: string;
  url?: string;
  description?: string;
  type?: string;
  year?: string;
  status?: string;
  associated?: Array<{ title: string }>;
  genres?: Array<{ genre: string }>;
  categories?: Array<{ category: string; votes?: number }>;
  authors?: Array<{ name: string; author_id?: number; type?: string }>;
  publishers?: Array<{
    publisher_name: string;
    publisher_id?: number;
    type?: string;
    notes?: string;
  }>;
}

/** Envelope for `POST /v1/series/search` */
export interface MUSearchResponse {
  total_hits: number;
  page: number;
  per_page: number;
  results: Array<{
    record: MUSeries;
    hit_title?: string;
  }>;
}
```

- [ ] **Step 2: Write the failing test for the API client**

Create `plugins/manga-enricher/src/__tests__/mangaupdates-api.test.ts`:

```typescript
import { fetchSeries, searchSeries } from "../mangaupdates/api";
import { describe, expect, it, vi } from "vitest";

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

describe("searchSeries", () => {
  it("POSTs to the search endpoint with the query in the body", () => {
    mockFetch({
      status: 200,
      ok: true,
      body: {
        total_hits: 1,
        page: 1,
        per_page: 25,
        results: [
          {
            record: { series_id: 55099564912, title: "One Piece" },
          },
        ],
      },
    });

    const results = searchSeries("One Piece");

    expect(results).toHaveLength(1);
    expect(results?.[0].title).toBe("One Piece");

    const call = vi.mocked(shisho.http.fetch).mock.calls[0];
    expect(call[0]).toBe("https://api.mangaupdates.com/v1/series/search");
    expect(call[1]?.method).toBe("POST");
    expect(JSON.parse(call[1]?.body as string)).toEqual({
      search: "One Piece",
      perpage: 10,
    });
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 500, ok: false });
    expect(searchSeries("foo")).toBeNull();
  });

  it("returns null on empty query", () => {
    expect(searchSeries("")).toBeNull();
    expect(shisho.http.fetch).not.toHaveBeenCalled();
  });
});

describe("fetchSeries", () => {
  it("GETs the series detail endpoint", () => {
    mockFetch({
      status: 200,
      ok: true,
      body: { series_id: 55099564912, title: "One Piece" },
    });

    const series = fetchSeries(55099564912);

    expect(series?.title).toBe("One Piece");
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      "https://api.mangaupdates.com/v1/series/55099564912",
      expect.objectContaining({
        headers: expect.any(Object),
      }),
    );
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 404, ok: false });
    expect(fetchSeries(123)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: FAIL with "Cannot find module '../mangaupdates/api'".

- [ ] **Step 4: Create `plugins/manga-enricher/src/mangaupdates/api.ts`**

```typescript
import type { MUSearchResponse, MUSeries } from "./types";

const USER_AGENT =
  "ShishoPlugin/0.1.0 (manga-enricher; github.com/shishobooks/plugins)";

const BASE_URL = "https://api.mangaupdates.com/v1";

const SEARCH_PER_PAGE = 10;

/**
 * Search MangaUpdates for series matching the query string.
 * Returns null on HTTP error or empty query; returns the MUSeries records
 * from the search response on success.
 */
export function searchSeries(query: string): MUSeries[] | null {
  if (!query || !query.trim()) return null;

  const url = `${BASE_URL}/series/search`;
  shisho.log.debug(`MU search: ${query}`);

  const response = shisho.http.fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      search: query,
      perpage: SEARCH_PER_PAGE,
    }),
  });

  if (!response || !response.ok) {
    shisho.log.warn(
      `MU search HTTP ${response?.status ?? "no response"} for "${query}"`,
    );
    return null;
  }

  try {
    const data = response.json() as MUSearchResponse;
    return data.results.map((r) => r.record);
  } catch {
    shisho.log.warn(`MU search: failed to parse response for "${query}"`);
    return null;
  }
}

/**
 * Fetch the full series detail by MangaUpdates series_id.
 * Returns null on HTTP error or parse failure.
 */
export function fetchSeries(seriesId: number): MUSeries | null {
  const url = `${BASE_URL}/series/${seriesId}`;
  shisho.log.debug(`MU fetchSeries: ${seriesId}`);

  const response = shisho.http.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!response || !response.ok) {
    shisho.log.warn(
      `MU fetchSeries HTTP ${response?.status ?? "no response"} for ${seriesId}`,
    );
    return null;
  }

  try {
    return response.json() as MUSeries;
  } catch {
    shisho.log.warn(`MU fetchSeries: failed to parse response for ${seriesId}`);
    return null;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: PASS (all existing tests + new API tests).

- [ ] **Step 6: Commit**

```bash
git add plugins/manga-enricher/src/mangaupdates plugins/manga-enricher/src/__tests__/mangaupdates-api.test.ts
git commit -m "[Feature] MangaUpdates API client"
```

---

### Task 6: MangaUpdates response mapping

**Files:**
- Create: `plugins/manga-enricher/src/mangaupdates/mapping.ts`
- Create: `plugins/manga-enricher/src/__tests__/mangaupdates-mapping.test.ts`

This task maps an `MUSeries` object to a `ParsedMetadata` with series-level fields. Per-volume fields (`releaseDate`, `pageCount`, etc.) are left to the publisher scrapers in later tasks.

- [ ] **Step 1: Write the failing test**

Create `plugins/manga-enricher/src/__tests__/mangaupdates-mapping.test.ts`:

```typescript
import { seriesToMetadata, pickEnglishPublisher } from "../mangaupdates/mapping";
import type { MUSeries } from "../mangaupdates/types";
import { describe, expect, it } from "vitest";

const sampleSeries: MUSeries = {
  series_id: 55099564912,
  title: "One Piece",
  url: "https://www.mangaupdates.com/series/pb8uwds/one-piece",
  description: "From Viz:  \nAs a child, Monkey D. Luffy...",
  type: "Manga",
  year: "1997",
  status: "114 Volumes (Ongoing)",
  associated: [{ title: "ワンピース" }, { title: "海贼王" }],
  genres: [
    { genre: "Action" },
    { genre: "Adventure" },
    { genre: "Shounen" },
  ],
  categories: [
    { category: "Pirates", votes: 200 },
    { category: "Devil Fruits", votes: 150 },
    { category: "Low-quality", votes: 1 },
  ],
  authors: [
    { name: "ODA Eiichiro", type: "Author" },
    { name: "ODA Eiichiro", type: "Artist" },
  ],
  publishers: [
    { publisher_name: "Shueisha", type: "Original" },
    { publisher_name: "VIZ Media", type: "English" },
  ],
};

describe("seriesToMetadata", () => {
  it("maps core series fields", () => {
    const md = seriesToMetadata(sampleSeries);
    expect(md.title).toBe("One Piece");
    expect(md.series).toBe("One Piece");
    expect(md.url).toBe(sampleSeries.url);
    expect(md.language).toBe("en");
    expect(md.identifiers).toEqual([
      { type: "mangaupdates_series", value: "55099564912" },
    ]);
  });

  it("maps authors to ParsedAuthor with roles", () => {
    const md = seriesToMetadata(sampleSeries);
    expect(md.authors).toEqual([
      { name: "ODA Eiichiro", role: "writer" },
      { name: "ODA Eiichiro", role: "penciller" },
    ]);
  });

  it("maps genres from genres[]", () => {
    const md = seriesToMetadata(sampleSeries);
    expect(md.genres).toEqual(["Action", "Adventure", "Shounen"]);
  });

  it("maps tags from categories[], filtering low-vote entries", () => {
    const md = seriesToMetadata(sampleSeries);
    // categories with votes >= 2 survive (the "Low-quality" one is dropped)
    expect(md.tags).toEqual(["Pirates", "Devil Fruits"]);
  });

  it("uses the English publisher as the primary publisher", () => {
    const md = seriesToMetadata(sampleSeries);
    expect(md.publisher).toBe("VIZ Media");
  });

  it("strips HTML from the description", () => {
    const series: MUSeries = {
      ...sampleSeries,
      description: "<p>Paragraph one.</p><p>Paragraph two.</p>",
    };
    const md = seriesToMetadata(series);
    expect(md.description).toBe("Paragraph one.\n\nParagraph two.");
  });

  it("omits empty optional fields", () => {
    const minimal: MUSeries = { series_id: 1, title: "X" };
    const md = seriesToMetadata(minimal);
    expect(md.title).toBe("X");
    expect(md.authors).toBeUndefined();
    expect(md.publisher).toBeUndefined();
    expect(md.genres).toBeUndefined();
    expect(md.tags).toBeUndefined();
    expect(md.description).toBeUndefined();
  });
});

describe("pickEnglishPublisher", () => {
  it("returns the first publisher with type 'English'", () => {
    expect(pickEnglishPublisher(sampleSeries)).toBe("VIZ Media");
  });

  it("returns undefined when no English publisher is present", () => {
    const series: MUSeries = {
      ...sampleSeries,
      publishers: [{ publisher_name: "Shueisha", type: "Original" }],
    };
    expect(pickEnglishPublisher(series)).toBeUndefined();
  });

  it("returns undefined when publishers is missing", () => {
    const series: MUSeries = { series_id: 1, title: "X" };
    expect(pickEnglishPublisher(series)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: FAIL with "Cannot find module '../mangaupdates/mapping'".

- [ ] **Step 3: Create `plugins/manga-enricher/src/mangaupdates/mapping.ts`**

```typescript
import type { MUSeries } from "./types";
import { stripHTML } from "@shisho-plugins/shared";
import type { ParsedAuthor, ParsedMetadata } from "@shisho/plugin-sdk";

/** Minimum community votes for a category to be included as a tag. */
const MIN_CATEGORY_VOTES = 2;

/**
 * Return the name of the first English-type publisher, or undefined.
 */
export function pickEnglishPublisher(series: MUSeries): string | undefined {
  return series.publishers?.find((p) => p.type === "English")?.publisher_name;
}

/**
 * Map an MUSeries to ParsedMetadata covering series-level fields only.
 * Per-volume fields (releaseDate, pageCount, isbn, synopsis per volume)
 * are layered on top by publisher scrapers.
 */
export function seriesToMetadata(series: MUSeries): ParsedMetadata {
  const metadata: ParsedMetadata = {};

  metadata.title = series.title;
  metadata.series = series.title;

  if (series.authors && series.authors.length > 0) {
    const authors: ParsedAuthor[] = series.authors.map((a) => {
      const role =
        a.type === "Artist"
          ? "penciller"
          : a.type === "Author"
            ? "writer"
            : "";
      return role ? { name: a.name, role } : { name: a.name };
    });
    metadata.authors = authors;
  }

  if (series.genres && series.genres.length > 0) {
    metadata.genres = series.genres.map((g) => g.genre);
  }

  if (series.categories && series.categories.length > 0) {
    const tags = series.categories
      .filter((c) => (c.votes ?? 0) >= MIN_CATEGORY_VOTES)
      .map((c) => c.category);
    if (tags.length > 0) metadata.tags = tags;
  }

  if (series.description) {
    metadata.description = stripHTML(series.description);
  }

  const englishPublisher = pickEnglishPublisher(series);
  if (englishPublisher) {
    metadata.publisher = englishPublisher;
  }

  if (series.url) {
    metadata.url = series.url;
  }

  metadata.language = "en";
  metadata.identifiers = [
    { type: "mangaupdates_series", value: String(series.series_id) },
  ];

  return metadata;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/mangaupdates/mapping.ts plugins/manga-enricher/src/__tests__/mangaupdates-mapping.test.ts
git commit -m "[Feature] MangaUpdates response mapping"
```

---

### Task 7: Publisher scraper interface

**Files:**
- Create: `plugins/manga-enricher/src/publishers/types.ts`

No test for this task — it's a pure type declaration used by later tasks. Tasks 8 and 9 will have tests that depend on this interface.

- [ ] **Step 1: Create `plugins/manga-enricher/src/publishers/types.ts`**

```typescript
/**
 * Per-volume metadata pulled from a publisher's product page.
 * All fields are optional — the scraper returns whatever it could extract.
 */
export interface VolumeMetadata {
  /** Full volume title (e.g., "One Piece, Vol. 1"). */
  title?: string;
  /** Volume subtitle (e.g., "Romance Dawn"). */
  subtitle?: string;
  /** Per-volume synopsis. */
  description?: string;
  /** ISO 8601 date string. */
  releaseDate?: string;
  /** ISBN-13. When multiple ISBNs exist, prefer the ebook variant. */
  isbn13?: string;
  /** ISBN-10. When multiple ISBNs exist, prefer the ebook variant. */
  isbn10?: string;
  /** Number of pages. */
  pageCount?: number;
  /** Publisher imprint (e.g., "Shonen Jump" on Viz). */
  imprint?: string;
  /** Age rating string (e.g., "Teen", "16+"). */
  ageRating?: string;
  /** Publisher product page URL. */
  url?: string;
}

/**
 * Interface implemented by every publisher scraper module.
 *
 * Each scraper is a self-contained unit. To add a new publisher, create a
 * new module under `publishers/` that implements this interface, then
 * register it in the scraper registry in `lookup.ts`.
 */
export interface PublisherScraper {
  /** Human-readable name (e.g., "Viz Media"). */
  readonly name: string;

  /**
   * Return true if the given MangaUpdates publisher name belongs to this
   * scraper (case-insensitive substring match is typical).
   */
  matchPublisher(publisherName: string): boolean;

  /**
   * Look up per-volume metadata for a specific volume of a series.
   * Returns null if the volume can't be found or any error occurs.
   * Must not throw — always return null on failure.
   */
  searchVolume(
    seriesTitle: string,
    volumeNumber: number,
    edition?: string,
  ): VolumeMetadata | null;
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `pnpm --filter @shisho-plugins/manga-enricher exec tsc --noEmit`
Expected: No errors.

(If that command isn't wired per-package, run `pnpm lint:types` from the repo root.)

- [ ] **Step 3: Commit**

```bash
git add plugins/manga-enricher/src/publishers/types.ts
git commit -m "[Feature] Publisher scraper interface"
```

---

### Task 8: Viz Media scraper

**Files:**
- Create: `plugins/manga-enricher/src/publishers/viz.ts`
- Create: `plugins/manga-enricher/src/__tests__/viz.test.ts`
- Create: `plugins/manga-enricher/src/__tests__/fixtures/viz-one-piece-vol1-search.html`
- Create: `plugins/manga-enricher/src/__tests__/fixtures/viz-one-piece-vol1-product.html`

The Viz scraper does a two-step flow: hit the search page, find the product link for the matching volume, then fetch the product page and extract metadata. We test against fixture HTML snippets rather than against the live site.

**Before writing code, capture real fixture HTML:**

- [ ] **Step 1: Capture fixture HTML for Viz search**

Run from the repo root:

```bash
mkdir -p plugins/manga-enricher/src/__tests__/fixtures
curl -sL -A "Mozilla/5.0" "https://www.viz.com/search?search=one+piece&category=Manga" \
  > plugins/manga-enricher/src/__tests__/fixtures/viz-one-piece-vol1-search.html
```

Verify the file is non-empty and contains product links by running:
`ls -lh plugins/manga-enricher/src/__tests__/fixtures/viz-one-piece-vol1-search.html` (size should be > 10KB).

- [ ] **Step 2: Capture fixture HTML for a Viz product page**

```bash
curl -sL -A "Mozilla/5.0" "https://www.viz.com/manga-books/manga/one-piece-volume-1-0/product/139" \
  > plugins/manga-enricher/src/__tests__/fixtures/viz-one-piece-vol1-product.html
```

Verify the file is non-empty.

- [ ] **Step 3: Inspect the captured HTML and identify extraction targets**

Use Grep to find what's actually in the page — do NOT assume the structure. Look for:
- The product link pattern in the search page: `grep -o 'href="/manga-books/manga/[^"]*"' plugins/manga-enricher/src/__tests__/fixtures/viz-one-piece-vol1-search.html | head -20`
- The title, description, ISBN, release date, page count, imprint, and age rating in the product page:
  - `grep -i 'isbn' plugins/manga-enricher/src/__tests__/fixtures/viz-one-piece-vol1-product.html | head`
  - `grep -i 'release\|date' plugins/manga-enricher/src/__tests__/fixtures/viz-one-piece-vol1-product.html | head`
  - `grep -i 'pages\|page count' plugins/manga-enricher/src/__tests__/fixtures/viz-one-piece-vol1-product.html | head`
  - Look for `"volumeNumber"`, `og:description`, JSON-LD `<script type="application/ld+json">`

Write down (in a scratch file or your head) the exact regex or DOM-path-like approach for each field. This is reconnaissance — no code changes yet.

- [ ] **Step 4: Write the failing tests for the Viz scraper**

Create `plugins/manga-enricher/src/__tests__/viz.test.ts`:

```typescript
import { vizScraper } from "../publishers/viz";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const searchHtml = readFileSync(
  resolve(__dirname, "fixtures/viz-one-piece-vol1-search.html"),
  "utf-8",
);
const productHtml = readFileSync(
  resolve(__dirname, "fixtures/viz-one-piece-vol1-product.html"),
  "utf-8",
);

function mockFetchSequence(
  responses: Array<{ status: number; ok: boolean; body: string }>,
) {
  const mock = vi.mocked(shisho.http.fetch);
  for (const r of responses) {
    mock.mockReturnValueOnce({
      status: r.status,
      statusText: r.ok ? "OK" : "Error",
      ok: r.ok,
      text: () => r.body,
      json: () => {
        throw new Error("not json");
      },
    } as ReturnType<typeof shisho.http.fetch>);
  }
}

describe("vizScraper.matchPublisher", () => {
  it("matches 'VIZ Media'", () => {
    expect(vizScraper.matchPublisher("VIZ Media")).toBe(true);
  });

  it("matches 'Viz Media, LLC'", () => {
    expect(vizScraper.matchPublisher("Viz Media, LLC")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(vizScraper.matchPublisher("viz media")).toBe(true);
  });

  it("does not match unrelated publishers", () => {
    expect(vizScraper.matchPublisher("Kodansha USA")).toBe(false);
    expect(vizScraper.matchPublisher("Yen Press")).toBe(false);
  });
});

describe("vizScraper.searchVolume", () => {
  it("fetches search then product and returns per-volume metadata", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: searchHtml },
      { status: 200, ok: true, body: productHtml },
    ]);

    const result = vizScraper.searchVolume("One Piece", 1);

    expect(result).not.toBeNull();
    // Exact assertions depend on what Viz actually returns in the HTML.
    // Assert on fields that MUST be present.
    expect(result?.title).toMatch(/one piece/i);
    expect(result?.description).toBeDefined();
    expect(result?.description?.length).toBeGreaterThan(20);
    expect(result?.url).toContain("viz.com/manga-books/manga/");
    // ISBN-13 should be a 13-digit string if present
    if (result?.isbn13) {
      expect(result.isbn13).toMatch(/^\d{13}$/);
    }
  });

  it("returns null when the search page returns an error", () => {
    mockFetchSequence([{ status: 500, ok: false, body: "" }]);
    expect(vizScraper.searchVolume("One Piece", 1)).toBeNull();
  });

  it("returns null when the search page has no matching product link", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: "<html><body>nothing</body></html>" },
    ]);
    expect(vizScraper.searchVolume("One Piece", 1)).toBeNull();
  });

  it("returns null when the product page returns an error", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: searchHtml },
      { status: 500, ok: false, body: "" },
    ]);
    expect(vizScraper.searchVolume("One Piece", 1)).toBeNull();
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: FAIL with "Cannot find module '../publishers/viz'".

- [ ] **Step 6: Create `plugins/manga-enricher/src/publishers/viz.ts`**

The implementation depends on what you found in Step 3. The structure below is correct; the regexes in `parseProduct` must be adjusted to match the actual HTML.

```typescript
import type { PublisherScraper, VolumeMetadata } from "./types";
import { stripHTML } from "@shisho-plugins/shared";

const USER_AGENT =
  "ShishoPlugin/0.1.0 (manga-enricher; github.com/shishobooks/plugins)";

const SEARCH_URL = "https://www.viz.com/search";
const BASE_URL = "https://www.viz.com";

function fetchHtml(url: string): string | null {
  shisho.log.debug(`Viz: fetching ${url}`);
  const response = shisho.http.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response || !response.ok) {
    shisho.log.warn(`Viz: HTTP ${response?.status ?? "no response"} ${url}`);
    return null;
  }
  return response.text();
}

/**
 * Build a search URL for the given query. Appends the edition variant if
 * provided so that editions (e.g., "Omnibus Edition") are treated as
 * distinct series by Viz's search.
 */
function buildSearchUrl(seriesTitle: string, edition?: string): string {
  const q = edition ? `${seriesTitle} ${edition}` : seriesTitle;
  const qs = shisho.url.searchParams({ search: q, category: "Manga" });
  return `${SEARCH_URL}?${qs}`;
}

/**
 * Scan the search HTML and pick the product path that corresponds to the
 * requested volume number. Viz product paths look like
 * `/manga-books/manga/<slug>-volume-<N>-0/product/<id>` — the slug always
 * ends with `volume-<N>-0` for single volumes. For editions, the slug
 * includes the edition words (e.g., `one-piece-omnibus-edition-volume-5-0`).
 */
export function pickProductPath(
  searchHtml: string,
  volumeNumber: number,
): string | null {
  const linkRegex =
    /href="(\/manga-books\/manga\/[^"]*?volume-(\d+)-0\/product\/\d+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(searchHtml)) !== null) {
    const [, path, num] = match;
    if (parseInt(num, 10) === volumeNumber) {
      return path;
    }
  }
  return null;
}

/**
 * Extract a single field from raw HTML using a regex that captures one
 * group. Returns undefined if the pattern doesn't match.
 */
function matchOne(html: string, pattern: RegExp): string | undefined {
  const m = html.match(pattern);
  return m ? m[1].trim() : undefined;
}

/**
 * Parse a product HTML page into VolumeMetadata. The regex patterns here
 * were derived from inspecting a real Viz product page fixture; if Viz
 * changes its markup, these need to be re-derived from a fresh fixture.
 */
export function parseProduct(html: string, url: string): VolumeMetadata {
  const metadata: VolumeMetadata = { url };

  // Title: og:title meta tag, falling back to the <h2> product title.
  const ogTitle = matchOne(html, /<meta property="og:title" content="([^"]+)"/i);
  if (ogTitle) metadata.title = ogTitle;

  // Description: og:description meta tag.
  const ogDesc = matchOne(
    html,
    /<meta property="og:description" content="([^"]+)"/i,
  );
  if (ogDesc) metadata.description = stripHTML(ogDesc);

  // ISBN-13: labeled row in the product details table.
  const isbn13 = matchOne(html, /ISBN-13[^<]*<[^>]*>\s*([\d-]{13,17})/i);
  if (isbn13) metadata.isbn13 = isbn13.replace(/-/g, "");

  // Release date: labeled row.
  const releaseDate = matchOne(
    html,
    /Release(?:\s+Date)?[^<]*<[^>]*>\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i,
  );
  if (releaseDate) {
    const parsed = parseVizDate(releaseDate);
    if (parsed) metadata.releaseDate = parsed;
  }

  // Page count: labeled row.
  const pages = matchOne(html, /(\d+)\s*pages/i);
  if (pages) metadata.pageCount = parseInt(pages, 10);

  // Imprint: labeled row (e.g., "Shonen Jump").
  const imprint = matchOne(
    html,
    /Imprint[^<]*<[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i,
  );
  if (imprint) metadata.imprint = imprint;

  // Age rating: labeled row (e.g., "Teen").
  const ageRating = matchOne(html, /Age Rating[^<]*<[^>]*>\s*([^<]+?)\s*</i);
  if (ageRating) metadata.ageRating = ageRating;

  return metadata;
}

/**
 * Parse a Viz date string like "September 5, 2023" into ISO 8601.
 */
function parseVizDate(dateStr: string): string | undefined {
  const months: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };
  const m = dateStr.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return undefined;
  const month = months[m[1].toLowerCase()];
  if (!month) return undefined;
  const day = m[2].padStart(2, "0");
  return `${m[3]}-${month}-${day}T00:00:00Z`;
}

export const vizScraper: PublisherScraper = {
  name: "Viz Media",

  matchPublisher(publisherName: string): boolean {
    return /\bviz\b/i.test(publisherName);
  },

  searchVolume(
    seriesTitle: string,
    volumeNumber: number,
    edition?: string,
  ): VolumeMetadata | null {
    const searchUrl = buildSearchUrl(seriesTitle, edition);
    const searchHtml = fetchHtml(searchUrl);
    if (!searchHtml) return null;

    const productPath = pickProductPath(searchHtml, volumeNumber);
    if (!productPath) {
      shisho.log.debug(
        `Viz: no volume-${volumeNumber} product link found for "${seriesTitle}"`,
      );
      return null;
    }

    const productUrl = `${BASE_URL}${productPath}`;
    const productHtml = fetchHtml(productUrl);
    if (!productHtml) return null;

    return parseProduct(productHtml, productUrl);
  },
};
```

- [ ] **Step 7: Run the tests and adjust regexes to match the real fixture**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`

If any field assertions fail, open the fixture HTML, find where that field actually lives in the markup, and update the corresponding regex in `parseProduct`. Iterate until all tests pass. The goal is: `title`, `description`, and `url` must be present; `isbn13` and `releaseDate` should be present if Viz exposes them for that product.

Expected final state: PASS for all describe blocks.

- [ ] **Step 8: Commit**

```bash
git add plugins/manga-enricher/src/publishers/viz.ts plugins/manga-enricher/src/__tests__/viz.test.ts plugins/manga-enricher/src/__tests__/fixtures/viz-one-piece-vol1-search.html plugins/manga-enricher/src/__tests__/fixtures/viz-one-piece-vol1-product.html
git commit -m "[Feature] Viz Media publisher scraper"
```

---

### Task 9: Kodansha USA scraper

**Files:**
- Create: `plugins/manga-enricher/src/publishers/kodansha.ts`
- Create: `plugins/manga-enricher/src/__tests__/kodansha.test.ts`
- Create: `plugins/manga-enricher/src/__tests__/fixtures/kodansha-aot-vol1.html`

Kodansha pages use JSON-LD structured data (`Book` schema with `workExample` array), which is much cleaner to parse than raw HTML. The URL structure is predictable: `/series/{slug}/volume-{N}/`.

- [ ] **Step 1: Capture fixture HTML**

```bash
curl -sL -A "Mozilla/5.0" "https://kodansha.us/series/attack-on-titan/volume-1/" \
  > plugins/manga-enricher/src/__tests__/fixtures/kodansha-aot-vol1.html
```

Verify the file exists and contains JSON-LD: search for `<script type="application/ld+json">` in the file (should appear at least once).

- [ ] **Step 2: Inspect the JSON-LD to confirm its shape**

Open the fixture and find the JSON-LD block. Confirm it contains a `Book` object with:
- `name` (title)
- `description`
- `workExample` array — each element has `isbn` and typically a `bookFormat` (e.g., `EBook`, `Paperback`) and `datePublished`
- `numberOfPages` (may be at the top level or in `workExample`)

If the JSON-LD structure differs from the spec's expectation, note the actual shape before writing the parser. The parser in Step 4 must match reality.

- [ ] **Step 3: Write the failing test**

Create `plugins/manga-enricher/src/__tests__/kodansha.test.ts`:

```typescript
import { kodanshaScraper } from "../publishers/kodansha";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const aotHtml = readFileSync(
  resolve(__dirname, "fixtures/kodansha-aot-vol1.html"),
  "utf-8",
);

function mockFetch(status: number, ok: boolean, body: string) {
  vi.mocked(shisho.http.fetch).mockReturnValue({
    status,
    statusText: ok ? "OK" : "Error",
    ok,
    text: () => body,
    json: () => {
      throw new Error("not json");
    },
  } as ReturnType<typeof shisho.http.fetch>);
}

describe("kodanshaScraper.matchPublisher", () => {
  it("matches 'Kodansha USA'", () => {
    expect(kodanshaScraper.matchPublisher("Kodansha USA")).toBe(true);
  });

  it("matches 'Kodansha Comics'", () => {
    expect(kodanshaScraper.matchPublisher("Kodansha Comics")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(kodanshaScraper.matchPublisher("kodansha usa")).toBe(true);
  });

  it("does not match 'Shueisha' or 'Viz Media'", () => {
    expect(kodanshaScraper.matchPublisher("Shueisha")).toBe(false);
    expect(kodanshaScraper.matchPublisher("Viz Media")).toBe(false);
  });
});

describe("kodanshaScraper.searchVolume", () => {
  it("fetches the direct slug URL and parses JSON-LD", () => {
    mockFetch(200, true, aotHtml);

    const result = kodanshaScraper.searchVolume("Attack on Titan", 1);

    expect(result).not.toBeNull();
    expect(result?.title).toMatch(/attack on titan/i);
    expect(result?.description).toBeDefined();
    expect(result?.description?.length).toBeGreaterThan(20);
    expect(result?.url).toBe(
      "https://kodansha.us/series/attack-on-titan/volume-1/",
    );
    // If two ISBNs are present in workExample (ebook + paperback), the
    // ebook one must win.
    if (result?.isbn13) {
      expect(result.isbn13).toMatch(/^\d{13}$/);
    }
  });

  it("returns null on HTTP error", () => {
    mockFetch(404, false, "");
    expect(kodanshaScraper.searchVolume("Unknown Series", 1)).toBeNull();
  });

  it("slugifies the series title for the URL", () => {
    mockFetch(200, true, aotHtml);
    kodanshaScraper.searchVolume("Attack on Titan", 1);
    const call = vi.mocked(shisho.http.fetch).mock.calls[0];
    expect(call[0]).toBe(
      "https://kodansha.us/series/attack-on-titan/volume-1/",
    );
  });

  it("prefers the ebook ISBN when both are present", () => {
    // This test exercises the ebook-preference logic. We construct a
    // synthetic HTML blob with two ISBNs in workExample — one ebook, one
    // paperback — and confirm the ebook wins.
    const synthetic = `<html><head><script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Book",
  name: "Test Volume",
  description: "Test description goes here and is long enough.",
  workExample: [
    {
      "@type": "Book",
      bookFormat: "Paperback",
      isbn: "9781111111111",
      datePublished: "2020-01-01",
    },
    {
      "@type": "Book",
      bookFormat: "EBook",
      isbn: "9782222222222",
      datePublished: "2020-01-01",
    },
  ],
})}
</script></head><body></body></html>`;
    mockFetch(200, true, synthetic);

    const result = kodanshaScraper.searchVolume("Test", 1);
    expect(result?.isbn13).toBe("9782222222222");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: FAIL with "Cannot find module '../publishers/kodansha'".

- [ ] **Step 5: Create `plugins/manga-enricher/src/publishers/kodansha.ts`**

```typescript
import type { PublisherScraper, VolumeMetadata } from "./types";
import { stripHTML } from "@shisho-plugins/shared";

const USER_AGENT =
  "ShishoPlugin/0.1.0 (manga-enricher; github.com/shishobooks/plugins)";

const BASE_URL = "https://kodansha.us";

function fetchHtml(url: string): string | null {
  shisho.log.debug(`Kodansha: fetching ${url}`);
  const response = shisho.http.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response || !response.ok) {
    shisho.log.warn(
      `Kodansha: HTTP ${response?.status ?? "no response"} ${url}`,
    );
    return null;
  }
  return response.text();
}

/**
 * Slugify a series title for Kodansha's URL scheme: lowercase, replace
 * non-alphanumeric runs with single hyphens, trim leading/trailing hyphens.
 * Apostrophes are dropped rather than converted.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extract all JSON-LD script blocks from the HTML and return them as
 * parsed objects. Invalid JSON blocks are silently skipped.
 */
export function extractJsonLd(html: string): unknown[] {
  const results: unknown[] = [];
  const regex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    try {
      results.push(JSON.parse(match[1].trim()));
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return results;
}

interface JsonLdBook {
  "@type"?: string | string[];
  name?: string;
  description?: string;
  numberOfPages?: number;
  datePublished?: string;
  isbn?: string;
  workExample?: Array<{
    "@type"?: string | string[];
    bookFormat?: string;
    isbn?: string;
    datePublished?: string;
    numberOfPages?: number;
  }>;
}

/**
 * Find the first JSON-LD entity whose @type is (or contains) "Book".
 */
function findBookEntity(blocks: unknown[]): JsonLdBook | null {
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const typed = block as JsonLdBook;
    const type = typed["@type"];
    const matches =
      type === "Book" || (Array.isArray(type) && type.includes("Book"));
    if (matches) return typed;
  }
  return null;
}

/**
 * Pick an ISBN from a Book entity, preferring ebook editions over other
 * formats. Falls back to the top-level isbn if workExample is absent.
 * Returns both forms (isbn13 / isbn10) based on length.
 */
export function pickIsbn(book: JsonLdBook): { isbn13?: string; isbn10?: string } {
  const collect = (isbn?: string): { isbn13?: string; isbn10?: string } => {
    if (!isbn) return {};
    const cleaned = isbn.replace(/-/g, "");
    if (cleaned.length === 13) return { isbn13: cleaned };
    if (cleaned.length === 10) return { isbn10: cleaned };
    return {};
  };

  if (book.workExample && book.workExample.length > 0) {
    const ebook = book.workExample.find((w) =>
      /ebook|e-book|digital/i.test(w.bookFormat ?? ""),
    );
    if (ebook?.isbn) return collect(ebook.isbn);
    const anyWithIsbn = book.workExample.find((w) => !!w.isbn);
    if (anyWithIsbn?.isbn) return collect(anyWithIsbn.isbn);
  }

  return collect(book.isbn);
}

/**
 * Pick a release date from a Book entity, preferring workExample entries
 * over the top-level date.
 */
function pickReleaseDate(book: JsonLdBook): string | undefined {
  const raw =
    book.workExample?.find((w) => !!w.datePublished)?.datePublished ??
    book.datePublished;
  if (!raw) return undefined;
  // Schema.org datePublished is typically ISO 8601 already; normalize to
  // include a time component.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00Z`;
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01T00:00:00Z`;
  return raw;
}

/**
 * Parse a Kodansha product page into VolumeMetadata using JSON-LD.
 */
export function parseProduct(html: string, url: string): VolumeMetadata | null {
  const blocks = extractJsonLd(html);
  const book = findBookEntity(blocks);
  if (!book) return null;

  const metadata: VolumeMetadata = { url };

  if (book.name) metadata.title = book.name;
  if (book.description) metadata.description = stripHTML(book.description);

  const { isbn13, isbn10 } = pickIsbn(book);
  if (isbn13) metadata.isbn13 = isbn13;
  if (isbn10) metadata.isbn10 = isbn10;

  const releaseDate = pickReleaseDate(book);
  if (releaseDate) metadata.releaseDate = releaseDate;

  const pages =
    book.numberOfPages ??
    book.workExample?.find((w) => !!w.numberOfPages)?.numberOfPages;
  if (typeof pages === "number") metadata.pageCount = pages;

  return metadata;
}

export const kodanshaScraper: PublisherScraper = {
  name: "Kodansha USA",

  matchPublisher(publisherName: string): boolean {
    return /\bkodansha\b/i.test(publisherName);
  },

  searchVolume(
    seriesTitle: string,
    volumeNumber: number,
    _edition?: string,
  ): VolumeMetadata | null {
    const slug = slugify(seriesTitle);
    if (!slug) return null;

    const url = `${BASE_URL}/series/${slug}/volume-${volumeNumber}/`;
    const html = fetchHtml(url);
    if (!html) return null;

    return parseProduct(html, url);
  },
};
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`

If tests fail against the fixture, inspect the JSON-LD structure in the fixture and adjust `findBookEntity` or the field extraction as needed (for example, sometimes JSON-LD uses `@graph` to nest entities).

Expected final state: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/manga-enricher/src/publishers/kodansha.ts plugins/manga-enricher/src/__tests__/kodansha.test.ts plugins/manga-enricher/src/__tests__/fixtures/kodansha-aot-vol1.html
git commit -m "[Feature] Kodansha USA publisher scraper"
```

---

### Task 10: Lookup flow and scraper registry

**Files:**
- Create: `plugins/manga-enricher/src/lookup.ts`
- Create: `plugins/manga-enricher/src/__tests__/lookup.test.ts`

This task wires everything together: it parses the query, searches MangaUpdates, picks the best match via Levenshtein, routes to the right publisher scraper, merges series + per-volume metadata, and degrades gracefully on every failure.

- [ ] **Step 1: Write the failing test**

Create `plugins/manga-enricher/src/__tests__/lookup.test.ts`:

```typescript
import { fetchSeries, searchSeries } from "../mangaupdates/api";
import { kodanshaScraper } from "../publishers/kodansha";
import { vizScraper } from "../publishers/viz";
import { searchForManga } from "../lookup";
import type { MUSeries } from "../mangaupdates/types";
import type { SearchContext } from "@shisho/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("../mangaupdates/api", () => ({
  searchSeries: vi.fn(),
  fetchSeries: vi.fn(),
}));

vi.mock("../publishers/viz", () => ({
  vizScraper: {
    name: "Viz Media",
    matchPublisher: vi.fn(),
    searchVolume: vi.fn(),
  },
}));

vi.mock("../publishers/kodansha", () => ({
  kodanshaScraper: {
    name: "Kodansha USA",
    matchPublisher: vi.fn(),
    searchVolume: vi.fn(),
  },
}));

const mockedSearchSeries = vi.mocked(searchSeries);
const mockedFetchSeries = vi.mocked(fetchSeries);
const mockedVizMatch = vi.mocked(vizScraper.matchPublisher);
const mockedVizSearch = vi.mocked(vizScraper.searchVolume);
const mockedKodanshaMatch = vi.mocked(kodanshaScraper.matchPublisher);
const mockedKodanshaSearch = vi.mocked(kodanshaScraper.searchVolume);

function makeContext(overrides: Partial<SearchContext> = {}): SearchContext {
  return { query: "", ...overrides };
}

const onePieceSeries: MUSeries = {
  series_id: 55099564912,
  title: "One Piece",
  url: "https://www.mangaupdates.com/series/pb8uwds/one-piece",
  description: "From Viz: As a child, Monkey D. Luffy...",
  authors: [{ name: "ODA Eiichiro", type: "Author" }],
  genres: [{ genre: "Action" }, { genre: "Shounen" }],
  publishers: [{ publisher_name: "VIZ Media", type: "English" }],
  status: "114 Volumes (Ongoing)",
};

function setupDefaultMocks() {
  mockedSearchSeries.mockReturnValue(null);
  mockedFetchSeries.mockReturnValue(null);
  mockedVizMatch.mockImplementation((p: string) => /viz/i.test(p));
  mockedVizSearch.mockReturnValue(null);
  mockedKodanshaMatch.mockImplementation((p: string) => /kodansha/i.test(p));
  mockedKodanshaSearch.mockReturnValue(null);
}

describe("searchForManga", () => {
  describe("Tier 1: mangaupdates_series ID lookup", () => {
    it("fetches the series directly when identifier is present", () => {
      setupDefaultMocks();
      mockedFetchSeries.mockReturnValue(onePieceSeries);

      const context = makeContext({
        query: "One Piece v01.cbz",
        identifiers: [{ type: "mangaupdates_series", value: "55099564912" }],
      });

      const results = searchForManga(context);

      expect(mockedFetchSeries).toHaveBeenCalledWith(55099564912);
      expect(mockedSearchSeries).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
      expect(results[0].title).toBe("One Piece");
      expect(results[0].seriesNumber).toBe(1);
    });

    it("returns empty when ID lookup fails", () => {
      setupDefaultMocks();
      const context = makeContext({
        query: "One Piece",
        identifiers: [{ type: "mangaupdates_series", value: "999" }],
      });
      expect(searchForManga(context)).toEqual([]);
    });
  });

  describe("Tier 2: title search", () => {
    it("searches MangaUpdates with the parsed series title", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([onePieceSeries]);
      mockedFetchSeries.mockReturnValue(onePieceSeries);

      const context = makeContext({ query: "One Piece v01 (2010).cbz" });
      searchForManga(context);

      expect(mockedSearchSeries).toHaveBeenCalledWith("One Piece");
    });

    it("returns empty when search yields no results", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([]);

      const context = makeContext({ query: "Unknown Series v01.cbz" });
      expect(searchForManga(context)).toEqual([]);
    });

    it("filters out results that fail the Levenshtein threshold", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([
        { ...onePieceSeries, title: "A Totally Different Long Title Here" },
      ]);
      mockedFetchSeries.mockReturnValue({
        ...onePieceSeries,
        title: "A Totally Different Long Title Here",
      });

      const context = makeContext({ query: "One Piece v01.cbz" });
      expect(searchForManga(context)).toEqual([]);
    });

    it("computes confidence from Levenshtein distance", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([onePieceSeries]);
      mockedFetchSeries.mockReturnValue(onePieceSeries);

      const context = makeContext({ query: "One Piece v01.cbz" });
      const results = searchForManga(context);
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
    });

    it("sets seriesNumber from the parsed volume number", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([onePieceSeries]);
      mockedFetchSeries.mockReturnValue(onePieceSeries);

      const context = makeContext({ query: "One Piece v07.cbz" });
      const results = searchForManga(context);
      expect(results[0].seriesNumber).toBe(7);
    });

    it("retries with the prefix when the full title yields nothing", () => {
      setupDefaultMocks();
      const demonSlayerSeries: MUSeries = {
        ...onePieceSeries,
        series_id: 456,
        title: "Demon Slayer",
      };
      mockedSearchSeries
        .mockReturnValueOnce([]) // full title: no results
        .mockReturnValueOnce([demonSlayerSeries]); // prefix: match
      mockedFetchSeries.mockReturnValue(demonSlayerSeries);

      const context = makeContext({
        query: "Demon Slayer - Kimetsu no Yaiba v01.cbz",
      });
      const results = searchForManga(context);

      expect(mockedSearchSeries).toHaveBeenNthCalledWith(
        1,
        "Demon Slayer - Kimetsu no Yaiba",
      );
      expect(mockedSearchSeries).toHaveBeenNthCalledWith(2, "Demon Slayer");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe("Demon Slayer");
    });
  });

  describe("publisher scraping", () => {
    const vizVolumeData = {
      title: "One Piece, Vol. 1",
      description: "Full per-volume synopsis.",
      isbn13: "9781569319017",
      releaseDate: "2003-06-01T00:00:00Z",
      pageCount: 216,
      imprint: "Shonen Jump",
      url: "https://www.viz.com/manga-books/manga/one-piece-volume-1-0/product/139",
    };

    it("routes to Viz when the English publisher is Viz Media", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([onePieceSeries]);
      mockedFetchSeries.mockReturnValue(onePieceSeries);
      mockedVizSearch.mockReturnValue(vizVolumeData);

      const context = makeContext({ query: "One Piece v01.cbz" });
      const results = searchForManga(context);

      expect(mockedVizSearch).toHaveBeenCalledWith("One Piece", 1, undefined);
      expect(mockedKodanshaSearch).not.toHaveBeenCalled();
      expect(results[0].description).toBe("Full per-volume synopsis.");
      expect(results[0].pageCount).toBe(216);
      expect(results[0].imprint).toBe("Shonen Jump");
      expect(results[0].releaseDate).toBe("2003-06-01T00:00:00Z");
      expect(results[0].url).toBe(vizVolumeData.url);
      // ISBN identifier is merged in addition to mangaupdates_series.
      expect(results[0].identifiers).toEqual(
        expect.arrayContaining([
          { type: "mangaupdates_series", value: "55099564912" },
          { type: "isbn_13", value: "9781569319017" },
        ]),
      );
    });

    it("routes to Kodansha when the English publisher is Kodansha USA", () => {
      setupDefaultMocks();
      const aotSeries: MUSeries = {
        ...onePieceSeries,
        series_id: 123,
        title: "Attack on Titan",
        publishers: [
          { publisher_name: "Kodansha USA", type: "English" },
        ],
      };
      mockedSearchSeries.mockReturnValue([aotSeries]);
      mockedFetchSeries.mockReturnValue(aotSeries);
      mockedKodanshaSearch.mockReturnValue({
        description: "Kodansha synopsis.",
        isbn13: "9781612620244",
      });

      const context = makeContext({ query: "Attack on Titan v01.cbz" });
      const results = searchForManga(context);

      expect(mockedKodanshaSearch).toHaveBeenCalledWith(
        "Attack on Titan",
        1,
        undefined,
      );
      expect(mockedVizSearch).not.toHaveBeenCalled();
      expect(results[0].description).toBe("Kodansha synopsis.");
    });

    it("falls back through all scrapers when publisher is unmatched", () => {
      setupDefaultMocks();
      const mysterySeries: MUSeries = {
        ...onePieceSeries,
        publishers: [
          { publisher_name: "Some Other Publisher", type: "English" },
        ],
      };
      mockedSearchSeries.mockReturnValue([mysterySeries]);
      mockedFetchSeries.mockReturnValue(mysterySeries);
      mockedVizSearch.mockReturnValue(null);
      mockedKodanshaSearch.mockReturnValue(vizVolumeData);

      const context = makeContext({ query: "One Piece v01.cbz" });
      const results = searchForManga(context);

      expect(mockedVizSearch).toHaveBeenCalled();
      expect(mockedKodanshaSearch).toHaveBeenCalled();
      expect(results[0].description).toBe("Full per-volume synopsis.");
    });

    it("returns series-level metadata when no scraper finds the volume", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([onePieceSeries]);
      mockedFetchSeries.mockReturnValue(onePieceSeries);
      mockedVizSearch.mockReturnValue(null);

      const context = makeContext({ query: "One Piece v01.cbz" });
      const results = searchForManga(context);

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("One Piece");
      expect(results[0].seriesNumber).toBe(1);
      expect(results[0].description).toContain("Monkey D. Luffy");
      // No per-volume fields from scraper.
      expect(results[0].pageCount).toBeUndefined();
    });

    it("skips scraping when no volume number could be parsed", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([onePieceSeries]);
      mockedFetchSeries.mockReturnValue(onePieceSeries);

      const context = makeContext({ query: "One Piece" });
      const results = searchForManga(context);

      expect(mockedVizSearch).not.toHaveBeenCalled();
      expect(mockedKodanshaSearch).not.toHaveBeenCalled();
      expect(results[0].title).toBe("One Piece");
    });

    it("passes the edition variant to the scraper", () => {
      setupDefaultMocks();
      const fruitsBasketSeries: MUSeries = {
        ...onePieceSeries,
        series_id: 789,
        title: "Fruits Basket",
      };
      mockedSearchSeries.mockReturnValue([fruitsBasketSeries]);
      mockedFetchSeries.mockReturnValue(fruitsBasketSeries);
      mockedVizSearch.mockReturnValue(vizVolumeData);

      const context = makeContext({
        query: "Fruits Basket Collector's Edition v01 (2016).cbz",
      });
      searchForManga(context);

      expect(mockedVizSearch).toHaveBeenCalledWith(
        "Fruits Basket",
        1,
        "Collector's Edition",
      );
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: FAIL with "Cannot find module '../lookup'".

- [ ] **Step 3: Create `plugins/manga-enricher/src/lookup.ts`**

```typescript
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
 * isbn, ageRating, subtitle).
 */
function mergeVolumeData(
  metadata: ParsedMetadata,
  volumeData: VolumeMetadata,
): void {
  if (volumeData.title) metadata.title = volumeData.title;
  if (volumeData.subtitle) metadata.subtitle = volumeData.subtitle;
  if (volumeData.description) metadata.description = volumeData.description;
  if (volumeData.releaseDate) metadata.releaseDate = volumeData.releaseDate;
  if (volumeData.pageCount !== undefined) metadata.pageCount = volumeData.pageCount;
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
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: PASS for all describe blocks in lookup.test.ts, and no regressions in the earlier tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/lookup.ts plugins/manga-enricher/src/__tests__/lookup.test.ts
git commit -m "[Feature] Lookup flow wiring MangaUpdates and publisher scrapers"
```

---

### Task 11: Plugin entry point

**Files:**
- Create: `plugins/manga-enricher/src/index.ts`

- [ ] **Step 1: Create `plugins/manga-enricher/src/index.ts`**

```typescript
import { searchForManga } from "./lookup";
import type {
  SearchContext,
  SearchResponse,
  ShishoPlugin,
} from "@shisho/plugin-sdk";

const plugin: ShishoPlugin = {
  metadataEnricher: {
    search(context: SearchContext): SearchResponse {
      shisho.log.info("Manga enricher: searching");

      const results = searchForManga(context);
      shisho.log.info(`Found ${results.length} candidate(s)`);

      return { results };
    },
  },
};

// Export for esbuild IIFE bundling - this becomes the return value
export default plugin;
```

- [ ] **Step 2: Build the plugin**

Run: `pnpm --filter @shisho-plugins/manga-enricher exec tsc --noEmit`
Then build the whole monorepo: `pnpm build`
Expected: No errors. `dist/manga-enricher/main.js` exists and is non-empty.

- [ ] **Step 3: Run the full plugin check**

Run: `pnpm check`
Expected: All lint, typecheck, and test steps pass.

- [ ] **Step 4: Commit**

```bash
git add plugins/manga-enricher/src/index.ts
git commit -m "[Feature] Manga enricher plugin entry point"
```

---

### Task 12: Register in repository.json

**Files:**
- Modify: `repository.json`

- [ ] **Step 1: Add the manga-enricher entry to `repository.json`**

Open `repository.json`. After the `audible-enricher` block (which is the last plugin in the `plugins` array), add a new entry. Read the existing `audible-enricher` entry first (at the bottom of `repository.json`) to mirror its exact shape — the `versions` array will be empty at this stage because no release has happened yet.

Add this entry as the last element of the `plugins` array (after `audible-enricher`):

```json
{
  "id": "manga-enricher",
  "name": "Manga Enricher",
  "overview": "Fetches manga metadata from MangaUpdates and per-volume details from Viz Media and Kodansha USA",
  "description": "Enriches manga metadata from MangaUpdates and publisher websites (Viz, Kodansha USA)",
  "author": "Shisho Team",
  "homepage": "https://github.com/shishobooks/plugins",
  "imageUrl": "https://raw.githubusercontent.com/shishobooks/plugins/master/plugins/manga-enricher/logo.svg",
  "versions": []
}
```

Note: the `versions` array is intentionally empty. The `pnpm release` workflow populates it when the first release is cut. Do not fabricate a version entry here — the release script will do it with real SHA256 hashes and download URLs.

- [ ] **Step 2: Verify repository.json is still valid JSON**

Run: `python3 -m json.tool repository.json > /dev/null && echo "ok"`
Expected output: `ok`

- [ ] **Step 3: Commit**

```bash
git add repository.json
git commit -m "[Chore] Register manga-enricher in plugin repository"
```

---

### Task 13: Final verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full check suite**

Run: `pnpm check`
Expected: PASS — lint + test for the whole monorepo.

- [ ] **Step 2: Confirm the plugin builds cleanly**

Run: `pnpm build`
Expected: No errors; `dist/manga-enricher/main.js` and `dist/manga-enricher/manifest.json` exist.

- [ ] **Step 3: Run vitest directly on the manga-enricher tests with coverage summary**

Run: `pnpm --filter @shisho-plugins/manga-enricher test`
Expected: All tests pass. Visually confirm:
- `filename.test.ts` — 20+ test cases covering extension, noise, volume, edition
- `mangaupdates-api.test.ts` — POST search body, GET series detail, error handling
- `mangaupdates-mapping.test.ts` — author roles, publisher picking, tag filtering, description stripping
- `viz.test.ts` — matchPublisher, search+product flow, error paths
- `kodansha.test.ts` — matchPublisher, slug URL, ebook ISBN preference
- `lookup.test.ts` — ID lookup, title search, prefix fallback, publisher routing, graceful degradation

- [ ] **Step 4: Check git log shows a clean sequence of commits**

Run: `git log --oneline master..HEAD`
Expected: Commits for scaffold → filename parser (3 steps) → MU api → MU mapping → publisher types → Viz → Kodansha → lookup → index → repository registration. No "fixup" or "oops" commits.

- [ ] **Step 5: Final commit (if anything was fixed up during verification)**

If verification surfaced any issues that needed fixing, commit them with a descriptive message. Otherwise, no commit is needed.
