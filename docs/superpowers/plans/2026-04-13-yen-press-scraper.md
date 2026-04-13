# Yen Press Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Yen Press per-volume scraper to the `manga-enricher` plugin, parallel to the existing Viz and Kodansha scrapers.

**Architecture:** Two-step fetch — fetch `https://yenpress.com/series/<slug>` to find the product URL for a given volume number, then fetch the product page and parse detail boxes (ISBN, Release Date, Imprint), description, and cover. Module implements the `PublisherScraper` interface and is registered in `lookup.ts`.

**Tech Stack:** TypeScript, esbuild (IIFE target), vitest for tests, `shisho.html` (CSS-selector DOM queries), `shisho.http.fetch`, `@shisho-plugins/shared` for `stripHTML`.

**Spec:** `docs/superpowers/specs/2026-04-13-yen-press-scraper-design.md`

---

## File Structure

**New files:**
- `plugins/manga-enricher/src/publishers/yenpress.ts` — scraper module (slugify, fetchHtml, pickProductPath, parseProduct, helpers, exported `yenpressScraper`)
- `plugins/manga-enricher/src/__tests__/yenpress.test.ts` — vitest tests covering slugify, date parsing, product-path picking, `parseProduct`, `matchPublisher`, and the full `searchVolume` flow with mocked HTTP
- `plugins/manga-enricher/src/__tests__/fixtures/yenpress-takagi-series.html` — full HTML from `https://yenpress.com/series/teasing-master-takagi-san`
- `plugins/manga-enricher/src/__tests__/fixtures/yenpress-takagi-vol1-product.html` — full HTML from `https://yenpress.com/titles/9781975353308-teasing-master-takagi-san-vol-1`

**Modified files:**
- `plugins/manga-enricher/src/lookup.ts` — import and register `yenpressScraper`
- `plugins/manga-enricher/manifest.json` — add `yenpress.com` and `images.yenpress.com` to `httpAccess.domains`; extend descriptions to mention Yen Press

Responsibility split mirrors the existing Viz/Kodansha modules: each scraper owns its network + parsing code and exposes a `PublisherScraper`; `lookup.ts` only wires them into the registry.

---

## Task 1: Check out the existing scraper pattern

Read these files before starting so your implementation matches conventions:

- `plugins/manga-enricher/src/publishers/types.ts` — `PublisherScraper` and `VolumeMetadata` interfaces
- `plugins/manga-enricher/src/publishers/kodansha.ts` — direct-URL strategy, `fetchHtml` pattern, ISBN preference for ebook
- `plugins/manga-enricher/src/publishers/viz.ts` — two-step (search → product) pattern, regex-based product-path picking, date parsing (`parseVizDate`), label-row extraction
- `plugins/manga-enricher/src/__tests__/viz.test.ts` — `mockFetchSequence` helper for two-step fetch tests
- `plugins/manga-enricher/src/__tests__/kodansha.test.ts` — `mockFetch` helper for single-fetch tests

Conventions to follow:
- `fetchHtml(url)` local helper that returns `string | null`, logs via `shisho.log`, never throws
- All public functions that parse HTML should be exported so they can be unit-tested in isolation
- Scraper's `searchVolume` must never throw; return `null` on any failure
- Use `stripHTML` from `@shisho-plugins/shared` when text could contain HTML entities
- Use `shisho.html.parse` + `querySelector` / `querySelectorAll` — do not regex HTML except for the product-path picking step (matching Viz's approach)

No code changes in this task — it is reading only.

- [ ] **Step 1: Read all five files listed above**

- [ ] **Step 2: Confirm understanding of conventions before proceeding**

---

## Task 2: Download fixture HTML files

Save full HTML from the two reference pages so tests can run offline.

**Files:**
- Create: `plugins/manga-enricher/src/__tests__/fixtures/yenpress-takagi-series.html`
- Create: `plugins/manga-enricher/src/__tests__/fixtures/yenpress-takagi-vol1-product.html`

- [ ] **Step 1: Download the series page**

```bash
curl -sL -A "ShishoPlugin/0.1.0 (manga-enricher; github.com/shishobooks/plugins)" \
  "https://yenpress.com/series/teasing-master-takagi-san" \
  -o plugins/manga-enricher/src/__tests__/fixtures/yenpress-takagi-series.html
```

- [ ] **Step 2: Download the product page**

```bash
curl -sL -A "ShishoPlugin/0.1.0 (manga-enricher; github.com/shishobooks/plugins)" \
  "https://yenpress.com/titles/9781975353308-teasing-master-takagi-san-vol-1" \
  -o plugins/manga-enricher/src/__tests__/fixtures/yenpress-takagi-vol1-product.html
```

- [ ] **Step 3: Sanity-check the fixtures**

```bash
grep -c 'detail-box' plugins/manga-enricher/src/__tests__/fixtures/yenpress-takagi-vol1-product.html
grep -c 'teasing-master-takagi-san-vol-1' plugins/manga-enricher/src/__tests__/fixtures/yenpress-takagi-series.html
```

Expected: both counts should be non-zero (the product page has ~16 detail-boxes; the series page has at least one vol-1 href).

- [ ] **Step 4: Commit**

```bash
git add plugins/manga-enricher/src/__tests__/fixtures/yenpress-takagi-series.html \
        plugins/manga-enricher/src/__tests__/fixtures/yenpress-takagi-vol1-product.html
git commit -m "[Test] Add Yen Press HTML fixtures"
```

---

## Task 3: Skeleton scraper module with `matchPublisher`

Create the module with just the export and `matchPublisher`. Build on this in subsequent tasks.

**Files:**
- Create: `plugins/manga-enricher/src/publishers/yenpress.ts`
- Create: `plugins/manga-enricher/src/__tests__/yenpress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// plugins/manga-enricher/src/__tests__/yenpress.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { yenpressScraper } from "../publishers/yenpress";
import { describe, expect, it, vi } from "vitest";

describe("yenpressScraper.matchPublisher", () => {
  it("matches 'Yen Press'", () => {
    expect(yenpressScraper.matchPublisher("Yen Press")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(yenpressScraper.matchPublisher("yen press")).toBe(true);
  });

  it("tolerates extra whitespace", () => {
    expect(yenpressScraper.matchPublisher("Yen  Press")).toBe(true);
  });

  it("does not match unrelated publishers", () => {
    expect(yenpressScraper.matchPublisher("Kodansha USA")).toBe(false);
    expect(yenpressScraper.matchPublisher("Viz Media")).toBe(false);
  });

  it("does not match other Yen imprints (out of scope)", () => {
    expect(yenpressScraper.matchPublisher("Yen On")).toBe(false);
    expect(yenpressScraper.matchPublisher("JY")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test yenpress
```

Expected: FAIL — `Cannot find module '../publishers/yenpress'`.

- [ ] **Step 3: Create the skeleton module**

The skeleton only contains imports actually used by the initial `matchPublisher`/stub `searchVolume`. `fetchHtml`, `stripHTML`, and the helper functions are introduced in subsequent tasks as they become needed — this avoids lint errors for unused symbols.

```ts
// plugins/manga-enricher/src/publishers/yenpress.ts
import type { PublisherScraper, VolumeMetadata } from "./types";

export const yenpressScraper: PublisherScraper = {
  name: "Yen Press",

  matchPublisher(publisherName: string): boolean {
    return /\byen\s+press\b/i.test(publisherName);
  },

  searchVolume(
    _seriesTitle: string,
    _volumeNumber: number,
    _edition?: string,
  ): VolumeMetadata | null {
    return null;
  },
};
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm test yenpress
pnpm lint:types
```

Expected: matchPublisher tests pass; type check passes.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/yenpress.ts \
        plugins/manga-enricher/src/__tests__/yenpress.test.ts
git commit -m "[Feature] Yen Press scraper skeleton with matchPublisher"
```

---

## Task 4: Slug builder

Yen Press slug rule: lowercase, replace runs of non-alphanumeric with `-`, trim leading/trailing `-`. Apostrophes are *not* dropped first — they become hyphens. Edition is appended to series title before slugifying.

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/yenpress.ts` (add `buildSlug`)
- Modify: `plugins/manga-enricher/src/__tests__/yenpress.test.ts` (add tests)

- [ ] **Step 1: Write the failing tests**

Append to `yenpress.test.ts`:

```ts
import { buildSlug } from "../publishers/yenpress";

describe("buildSlug", () => {
  it("slugifies a plain series title", () => {
    expect(buildSlug("Teasing Master Takagi-san")).toBe(
      "teasing-master-takagi-san",
    );
  });

  it("turns apostrophes into hyphens (not drops them)", () => {
    expect(buildSlug("Fruits Basket Collector's Edition")).toBe(
      "fruits-basket-collector-s-edition",
    );
  });

  it("appends edition to the series title", () => {
    expect(buildSlug("Fruits Basket", "Collector's Edition")).toBe(
      "fruits-basket-collector-s-edition",
    );
  });

  it("trims leading and trailing punctuation", () => {
    expect(buildSlug("  !Hello World!  ")).toBe("hello-world");
  });

  it("returns empty string for punctuation-only input", () => {
    expect(buildSlug("!!!")).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm test yenpress
```

Expected: FAIL — `buildSlug` is not exported.

- [ ] **Step 3: Implement `buildSlug`**

Add to `yenpress.ts` (above the `yenpressScraper` export):

```ts
/**
 * Build the URL slug for a Yen Press series page. Lowercases, replaces runs
 * of non-alphanumeric characters with a single hyphen, and trims hyphens
 * from the ends. Apostrophes become hyphens along with spaces, so
 * "Fruits Basket Collector's Edition" produces
 * "fruits-basket-collector-s-edition" — matching the actual Yen Press
 * URL scheme. If an edition is provided, it's appended to the series title
 * before slugifying so editions share a series page with the base title
 * only when Yen Press itself does.
 */
export function buildSlug(seriesTitle: string, edition?: string): string {
  const base = edition ? `${seriesTitle} ${edition}` : seriesTitle;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm test yenpress
```

Expected: PASS on all new `buildSlug` tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/yenpress.ts \
        plugins/manga-enricher/src/__tests__/yenpress.test.ts
git commit -m "[Feature] Yen Press slug builder"
```

---

## Task 5: Volume product-path picker

Find the `/titles/...-vol-<N>` href for a requested volume number from the series-page HTML. Uses a regex (matching the approach in `viz.ts::pickProductPath`) rather than full DOM parsing.

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/yenpress.ts` (add `pickProductPath`)
- Modify: `plugins/manga-enricher/src/__tests__/yenpress.test.ts` (add tests)

- [ ] **Step 1: Write the failing tests**

Append to `yenpress.test.ts`:

```ts
import { pickProductPath } from "../publishers/yenpress";

const takagiSeriesHtml = readFileSync(
  resolve(__dirname, "fixtures/yenpress-takagi-series.html"),
  "utf-8",
);

describe("pickProductPath", () => {
  it("finds the product path for volume 1 from the real series page", () => {
    const path = pickProductPath(takagiSeriesHtml, 1);
    expect(path).toBe("/titles/9781975353308-teasing-master-takagi-san-vol-1");
  });

  it("finds higher-numbered volumes (vol 20)", () => {
    const path = pickProductPath(takagiSeriesHtml, 20);
    expect(path).toBe("/titles/9798855410716-teasing-master-takagi-san-vol-20");
  });

  it("returns null when the volume is absent", () => {
    expect(pickProductPath(takagiSeriesHtml, 999)).toBeNull();
  });

  it("does not confuse vol-1 with vol-10/11/12", () => {
    // Synthetic HTML where vol-10 appears BEFORE vol-1 in document order —
    // the picker must still return vol-1 when asked for 1, not vol-10.
    const html = `
      <a href="/titles/9999999999990-some-series-vol-10"></a>
      <a href="/titles/9999999999991-some-series-vol-1"></a>
    `;
    expect(pickProductPath(html, 1)).toBe(
      "/titles/9999999999991-some-series-vol-1",
    );
    expect(pickProductPath(html, 10)).toBe(
      "/titles/9999999999990-some-series-vol-10",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm test yenpress
```

Expected: FAIL — `pickProductPath` not exported.

- [ ] **Step 3: Implement `pickProductPath`**

Add to `yenpress.ts`:

```ts
/**
 * Scan the series-page HTML and pick the product path that corresponds to
 * the requested volume number. Yen Press product paths look like
 * `/titles/<ISBN>-<slug>-vol-<N>`. We can't build this path directly
 * because the ISBN segment is unknown up front, so we grep the series
 * page for matching links.
 *
 * The regex anchors the volume number at the end of the path (before a
 * closing quote) to avoid matching `vol-10` when the caller asked for
 * `vol-1`.
 */
export function pickProductPath(
  seriesHtml: string,
  volumeNumber: number,
): string | null {
  const linkRegex = /href="(\/titles\/[^"]*?-vol-(\d+))"/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(seriesHtml)) !== null) {
    const [, path, num] = match;
    if (parseInt(num, 10) === volumeNumber) {
      return path;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm test yenpress
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/yenpress.ts \
        plugins/manga-enricher/src/__tests__/yenpress.test.ts
git commit -m "[Feature] Yen Press product path picker"
```

---

## Task 6: Release-date parser

Yen Press formats dates as `Jul 24, 2018` (short month name). Accept both short and long month names so we don't break on Yen Press changing its rendering.

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/yenpress.ts` (add `parseYenPressDate`)
- Modify: `plugins/manga-enricher/src/__tests__/yenpress.test.ts` (add tests)

- [ ] **Step 1: Write the failing tests**

Append to `yenpress.test.ts`:

```ts
import { parseYenPressDate } from "../publishers/yenpress";

describe("parseYenPressDate", () => {
  it("parses short month names", () => {
    expect(parseYenPressDate("Jul 24, 2018")).toBe("2018-07-24T00:00:00Z");
  });

  it("parses long month names", () => {
    expect(parseYenPressDate("September 5, 2023")).toBe(
      "2023-09-05T00:00:00Z",
    );
  });

  it("zero-pads single-digit days", () => {
    expect(parseYenPressDate("Jan 3, 2020")).toBe("2020-01-03T00:00:00Z");
  });

  it("tolerates extra whitespace", () => {
    expect(parseYenPressDate("  Jul   24 , 2018  ")).toBe(
      "2018-07-24T00:00:00Z",
    );
  });

  it("returns undefined for unparseable input", () => {
    expect(parseYenPressDate("")).toBeUndefined();
    expect(parseYenPressDate("TBD")).toBeUndefined();
    expect(parseYenPressDate("2018-07-24")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm test yenpress
```

Expected: FAIL — `parseYenPressDate` not exported.

- [ ] **Step 3: Implement `parseYenPressDate`**

Add to `yenpress.ts`:

```ts
const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

/**
 * Parse a Yen Press date string like "Jul 24, 2018" or "September 5, 2023"
 * into ISO 8601 (with midnight UTC time component). Tolerates extra
 * whitespace between tokens. Returns undefined when input doesn't match.
 */
export function parseYenPressDate(dateStr: string): string | undefined {
  const normalized = dateStr.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^([A-Za-z]+)\s+(\d{1,2})\s*,\s*(\d{4})$/);
  if (!match) return undefined;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return undefined;
  const day = match[2].padStart(2, "0");
  return `${match[3]}-${month}-${day}T00:00:00Z`;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm test yenpress
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/yenpress.ts \
        plugins/manga-enricher/src/__tests__/yenpress.test.ts
git commit -m "[Feature] Yen Press date parser"
```

---

## Task 7: Product-page parser — description and cover

Start the `parseProduct` function with the easy bits. ISBN preference comes in the next task.

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/yenpress.ts` (add `parseProduct`, `extractDescription`, `extractCover`)
- Modify: `plugins/manga-enricher/src/__tests__/yenpress.test.ts` (add tests)

- [ ] **Step 1: Write the failing tests**

Append to `yenpress.test.ts`:

```ts
import { parseProduct } from "../publishers/yenpress";

const takagiProductHtml = readFileSync(
  resolve(__dirname, "fixtures/yenpress-takagi-vol1-product.html"),
  "utf-8",
);

describe("parseProduct — description and cover", () => {
  it("extracts the volume description", () => {
    const result = parseProduct(
      takagiProductHtml,
      "https://yenpress.com/titles/9781975353308-teasing-master-takagi-san-vol-1",
    );
    expect(result).not.toBeNull();
    expect(result?.description).toMatch(/^Middle schooler Nishikata/);
    // Description must not contain HTML tags.
    expect(result?.description).not.toMatch(/</);
  });

  it("sets the url field to the passed-in value", () => {
    const url =
      "https://yenpress.com/titles/9781975353308-teasing-master-takagi-san-vol-1";
    const result = parseProduct(takagiProductHtml, url);
    expect(result?.url).toBe(url);
  });

  it("extracts the cover image URL", () => {
    const result = parseProduct(
      takagiProductHtml,
      "https://yenpress.com/titles/9781975353308-teasing-master-takagi-san-vol-1",
    );
    expect(result?.coverUrl).toMatch(/^https:\/\/images\.yenpress\.com\/imgs\//);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm test yenpress
```

Expected: FAIL — `parseProduct` not exported.

- [ ] **Step 3: Implement `parseProduct` skeleton plus the two helpers**

Add the `stripHTML` import at the top of `yenpress.ts`:

```ts
import { stripHTML } from "@shisho-plugins/shared";
```

Then add the following above the `yenpressScraper` export:

```ts
/**
 * Extract the per-volume description from a Yen Press product page.
 *
 * The description lives in `<div class="content-heading-txt"> <p
 * class="paragraph fs-16">...</p></div>`. Yen Press also has a `<meta
 * name="description">` tag but it truncates at ~200 chars; the paragraph
 * block is the authoritative full text.
 */
function extractDescription(
  doc: ReturnType<typeof shisho.html.parse>,
): string | undefined {
  const container = shisho.html.querySelector(doc, "div.content-heading-txt");
  if (!container) return undefined;
  const paragraph = shisho.html.querySelector(container, "p.paragraph");
  const raw = paragraph?.text.trim();
  return raw ? stripHTML(raw) : undefined;
}

/**
 * Extract the per-volume cover URL from a Yen Press product page.
 *
 * Yen Press renders covers with a lazy-load pattern: `<img class="b-lazy"
 * data-src="https://images.yenpress.com/imgs/<ISBN>.jpg?...">`. The URL
 * lives in `data-src`, not `src` (which is usually empty or a placeholder).
 * We prefer the first `.book-cover-img img` on the page, which is the
 * main product cover; failing that, any `img[data-src]` under a
 * `.series-cover` block.
 */
function extractCover(
  doc: ReturnType<typeof shisho.html.parse>,
): string | undefined {
  const img = shisho.html.querySelector(doc, "div.book-cover-img img");
  const dataSrc = img?.attributes["data-src"];
  if (dataSrc) return dataSrc;
  const src = img?.attributes.src;
  return src && src.startsWith("http") ? src : undefined;
}

/**
 * Parse a Yen Press product page into VolumeMetadata. Returns null if the
 * page has no recognizable structure (e.g. an error page). Individual
 * fields are simply omitted when they can't be extracted.
 */
export function parseProduct(
  html: string,
  url: string,
): VolumeMetadata | null {
  const doc = shisho.html.parse(html);
  const metadata: VolumeMetadata = { url };

  const description = extractDescription(doc);
  if (description) metadata.description = description;

  const coverUrl = extractCover(doc);
  if (coverUrl) metadata.coverUrl = coverUrl;

  return metadata;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm test yenpress
pnpm lint:types
```

Expected: PASS on the new tests; type check passes.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/yenpress.ts \
        plugins/manga-enricher/src/__tests__/yenpress.test.ts
git commit -m "[Feature] Yen Press parseProduct — description and cover"
```

---

## Task 8: Product-page parser — detail-box fields (ISBN, Release Date, Imprint)

Add detail-box extraction with a helper that looks up values by label within a `.detail-info` block. ISBN prefers the digital block (2nd in document order) to match Kodansha's ebook preference.

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/yenpress.ts` (add helpers, extend `parseProduct`)
- Modify: `plugins/manga-enricher/src/__tests__/yenpress.test.ts` (add tests)

- [ ] **Step 1: Write the failing tests**

Append to `yenpress.test.ts`:

```ts
describe("parseProduct — detail-box fields", () => {
  const productUrl =
    "https://yenpress.com/titles/9781975353308-teasing-master-takagi-san-vol-1";

  it("extracts imprint", () => {
    const result = parseProduct(takagiProductHtml, productUrl);
    expect(result?.imprint).toBe("Yen Press");
  });

  it("prefers the digital ISBN over the print ISBN when both exist", () => {
    // Print ISBN is 9781975353308 (in the URL), digital is 9781975386122
    // (in the second detail-info block). Preference rule: digital wins.
    const result = parseProduct(takagiProductHtml, productUrl);
    expect(result?.isbn13).toBe("9781975386122");
  });

  it("extracts the release date as ISO 8601", () => {
    // First (print) block says Jul 24, 2018; digital block says Jul 23,
    // 2019. Release date follows the same digital-preferred rule as ISBN
    // — it's read from whichever detail-info block we picked.
    const result = parseProduct(takagiProductHtml, productUrl);
    expect(result?.releaseDate).toBe("2019-07-23T00:00:00Z");
  });

  it("falls back to the only block when there is just one", () => {
    const singleBlockHtml = `
      <html><body>
        <div class="detail-info">
          <div class="detail-box">
            <span class="type">ISBN</span>
            <p class="info">9780000000001</p>
          </div>
          <div class="detail-box">
            <span class="type">Release Date</span>
            <p class="info">Jan 1, 2020</p>
          </div>
          <div class="detail-box">
            <span class="type">Imprint</span>
            <p class="info">Yen Press</p>
          </div>
        </div>
      </body></html>
    `;
    const result = parseProduct(singleBlockHtml, "https://yenpress.com/x");
    expect(result?.isbn13).toBe("9780000000001");
    expect(result?.releaseDate).toBe("2020-01-01T00:00:00Z");
    expect(result?.imprint).toBe("Yen Press");
  });

  it("omits missing fields rather than throwing", () => {
    const emptyHtml = "<html><body></body></html>";
    const result = parseProduct(emptyHtml, "https://yenpress.com/x");
    expect(result).not.toBeNull();
    expect(result?.isbn13).toBeUndefined();
    expect(result?.releaseDate).toBeUndefined();
    expect(result?.imprint).toBeUndefined();
  });

  it("normalizes ISBN by stripping hyphens", () => {
    const html = `
      <html><body>
        <div class="detail-info">
          <div class="detail-box">
            <span class="type">ISBN</span>
            <p class="info">978-1-9753-5330-8</p>
          </div>
        </div>
      </body></html>
    `;
    const result = parseProduct(html, "https://yenpress.com/x");
    expect(result?.isbn13).toBe("9781975353308");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm test yenpress
```

Expected: FAIL — `parseProduct` doesn't yet populate these fields.

- [ ] **Step 3: Implement the helpers and extend `parseProduct`**

Add to `yenpress.ts` (above `parseProduct`):

```ts
/**
 * Find the value of a labelled detail-box within a scope element.
 *
 * Yen Press renders each field as:
 *
 *     <div class="detail-box">
 *       <span class="type paragraph fs-15">ISBN</span>
 *       <p class="info">9781975353308</p>
 *     </div>
 *
 * We iterate every `.detail-box` inside the scope, check its first `span`
 * child's text against `label` (case-insensitive), and return the first
 * `p.info` child. Irregular blocks (e.g. the print-side Imprint is not
 * wrapped in `.detail-box` on the fixture) are handled at a higher level
 * — the digital-preference logic picks a block whose Imprint is wrapped
 * correctly, so this helper's scope always matches.
 *
 * Trims whitespace and collapses runs — Yen Press uses HTML indentation
 * that otherwise leaks into `.text`.
 */
function extractDetailValue(
  scope: ReturnType<typeof shisho.html.parse>,
  label: string,
): string | undefined {
  const boxes = shisho.html.querySelectorAll(scope, "div.detail-box");
  for (const box of boxes) {
    const span = box.children.find((c) => c.tag === "span");
    if (!span) continue;
    if (span.text.trim().toLowerCase() !== label.toLowerCase()) continue;
    const info = box.children.find(
      (c) => c.tag === "p" && (c.attributes.class ?? "").includes("info"),
    );
    const value = info?.text.replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Pick the preferred detail-info block from a parsed product page.
 *
 * Yen Press product pages render a "print" `.detail-info` block followed
 * by a "digital" block. The only textual separator between them is an
 * HTML comment (`<!-- Main -->` / `<!-- Digital -->`) which `shisho.html`
 * doesn't expose, so we use position: if there are two or more blocks,
 * prefer the second (digital); otherwise use whatever's there.
 *
 * Returns null when no `.detail-info` block exists — the caller then
 * omits the detail-box-derived fields rather than throwing.
 */
function pickPreferredDetailBlock(
  doc: ReturnType<typeof shisho.html.parse>,
): ReturnType<typeof shisho.html.parse> | null {
  const blocks = shisho.html.querySelectorAll(doc, "div.detail-info");
  if (blocks.length === 0) return null;
  if (blocks.length >= 2) return blocks[1];
  return blocks[0];
}
```

Extend `parseProduct` (replace the earlier version):

```ts
export function parseProduct(
  html: string,
  url: string,
): VolumeMetadata | null {
  const doc = shisho.html.parse(html);
  const metadata: VolumeMetadata = { url };

  const description = extractDescription(doc);
  if (description) metadata.description = description;

  const coverUrl = extractCover(doc);
  if (coverUrl) metadata.coverUrl = coverUrl;

  const block = pickPreferredDetailBlock(doc);
  if (block) {
    const rawIsbn = extractDetailValue(block, "ISBN");
    if (rawIsbn) {
      const cleaned = rawIsbn.replace(/-/g, "");
      if (cleaned.length === 13) metadata.isbn13 = cleaned;
      else if (cleaned.length === 10) metadata.isbn10 = cleaned;
    }

    const rawDate = extractDetailValue(block, "Release Date");
    if (rawDate) {
      const parsed = parseYenPressDate(rawDate);
      if (parsed) metadata.releaseDate = parsed;
    }

    const imprint = extractDetailValue(block, "Imprint");
    if (imprint) metadata.imprint = imprint;
  }

  return metadata;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm test yenpress
pnpm lint:types
```

Expected: PASS on all tests. If one of the real-fixture assertions (`isbn13 === 9781975386122`, `releaseDate === 2019-07-23T00:00:00Z`) fails, inspect the fixture with `grep -n 'detail-info' plugins/manga-enricher/src/__tests__/fixtures/yenpress-takagi-vol1-product.html` — there must be at least two `div.detail-info` elements and the second must contain `9781975386122`.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/yenpress.ts \
        plugins/manga-enricher/src/__tests__/yenpress.test.ts
git commit -m "[Feature] Yen Press parseProduct — ISBN, release date, imprint"
```

---

## Task 9: Wire up `searchVolume` with two-step fetch

Connect slug → series page → product path → product page → `parseProduct` using the existing `fetchHtml` helper.

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/yenpress.ts` (fill in `searchVolume`)
- Modify: `plugins/manga-enricher/src/__tests__/yenpress.test.ts` (add end-to-end tests)

- [ ] **Step 1: Write the failing tests**

Append to `yenpress.test.ts`:

```ts
function mockFetchSequence(
  responses: Array<{ status: number; ok: boolean; body: string }>,
) {
  const mock = vi.mocked(shisho.http.fetch);
  mock.mockReset();
  for (const r of responses) {
    mock.mockReturnValueOnce({
      status: r.status,
      statusText: r.ok ? "OK" : "Error",
      ok: r.ok,
      text: () => r.body,
      json: () => JSON.parse(r.body || "null"),
    } as unknown as ReturnType<typeof shisho.http.fetch>);
  }
}

describe("yenpressScraper.searchVolume", () => {
  it("fetches the series page then the product page and returns merged metadata", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: takagiSeriesHtml },
      { status: 200, ok: true, body: takagiProductHtml },
    ]);

    const result = yenpressScraper.searchVolume("Teasing Master Takagi-san", 1);

    expect(result).not.toBeNull();
    expect(result?.url).toBe(
      "https://yenpress.com/titles/9781975353308-teasing-master-takagi-san-vol-1",
    );
    expect(result?.isbn13).toBe("9781975386122");
    expect(result?.imprint).toBe("Yen Press");
    expect(result?.description).toMatch(/^Middle schooler Nishikata/);

    const calls = vi.mocked(shisho.http.fetch).mock.calls;
    expect(calls[0][0]).toBe(
      "https://yenpress.com/series/teasing-master-takagi-san",
    );
    expect(calls[1][0]).toBe(
      "https://yenpress.com/titles/9781975353308-teasing-master-takagi-san-vol-1",
    );
  });

  it("appends edition to the slug before fetching the series page", () => {
    mockFetchSequence([
      { status: 404, ok: false, body: "" }, // series fetch fails
    ]);

    yenpressScraper.searchVolume(
      "Fruits Basket",
      1,
      "Collector's Edition",
    );

    const calls = vi.mocked(shisho.http.fetch).mock.calls;
    expect(calls[0][0]).toBe(
      "https://yenpress.com/series/fruits-basket-collector-s-edition",
    );
  });

  it("returns null when the series page 404s", () => {
    mockFetchSequence([{ status: 404, ok: false, body: "" }]);
    expect(
      yenpressScraper.searchVolume("No Such Series", 1),
    ).toBeNull();
  });

  it("returns null when the series page has no matching volume", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: takagiSeriesHtml },
    ]);
    expect(
      yenpressScraper.searchVolume("Teasing Master Takagi-san", 999),
    ).toBeNull();
  });

  it("returns null when the product page 404s", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: takagiSeriesHtml },
      { status: 404, ok: false, body: "" },
    ]);
    expect(
      yenpressScraper.searchVolume("Teasing Master Takagi-san", 1),
    ).toBeNull();
  });

  it("returns null when the series title is empty or punctuation-only", () => {
    expect(yenpressScraper.searchVolume("", 1)).toBeNull();
    expect(yenpressScraper.searchVolume("!!!", 1)).toBeNull();
    // No HTTP call should have been made.
    expect(vi.mocked(shisho.http.fetch)).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm test yenpress
```

Expected: FAIL — `searchVolume` currently returns `null` unconditionally.

- [ ] **Step 3: Add `fetchHtml` and implement `searchVolume`**

Add these constants and the `fetchHtml` helper near the top of `yenpress.ts` (below the imports):

```ts
const USER_AGENT =
  "ShishoPlugin/0.1.0 (manga-enricher; github.com/shishobooks/plugins)";

const BASE_URL = "https://yenpress.com";

function fetchHtml(url: string): string | null {
  shisho.log.debug(`YenPress: fetching ${url}`);
  const response = shisho.http.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response || !response.ok) {
    shisho.log.warn(
      `YenPress: HTTP ${response?.status ?? "no response"} ${url}`,
    );
    return null;
  }
  try {
    return response.text();
  } catch {
    shisho.log.warn(`YenPress: failed to read response body for ${url}`);
    return null;
  }
}
```

Then replace the placeholder `searchVolume` body:

```ts
export const yenpressScraper: PublisherScraper = {
  name: "Yen Press",

  matchPublisher(publisherName: string): boolean {
    return /\byen\s+press\b/i.test(publisherName);
  },

  searchVolume(
    seriesTitle: string,
    volumeNumber: number,
    edition?: string,
  ): VolumeMetadata | null {
    const slug = buildSlug(seriesTitle, edition);
    if (!slug) return null;

    const seriesUrl = `${BASE_URL}/series/${slug}`;
    const seriesHtml = fetchHtml(seriesUrl);
    if (!seriesHtml) return null;

    const productPath = pickProductPath(seriesHtml, volumeNumber);
    if (!productPath) {
      shisho.log.debug(
        `YenPress: no volume-${volumeNumber} product link found for "${seriesTitle}"`,
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

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm test yenpress
pnpm lint:types
```

Expected: PASS on all yenpress tests; type check passes.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/yenpress.ts \
        plugins/manga-enricher/src/__tests__/yenpress.test.ts
git commit -m "[Feature] Yen Press searchVolume end-to-end"
```

---

## Task 10: Register the scraper in `lookup.ts`

Add `yenpressScraper` to the `SCRAPERS` registry so `lookup.ts::findVolumeData` can pick it when MU lists a Yen Press publisher for a series.

**Files:**
- Modify: `plugins/manga-enricher/src/lookup.ts`

- [ ] **Step 1: Update the imports**

In `lookup.ts`, find the existing publisher imports:

```ts
import { kodanshaScraper } from "./publishers/kodansha";
import type { PublisherScraper, VolumeMetadata } from "./publishers/types";
import { vizScraper } from "./publishers/viz";
```

Add a new line below `vizScraper`:

```ts
import { yenpressScraper } from "./publishers/yenpress";
```

- [ ] **Step 2: Extend the registry**

Find:

```ts
const SCRAPERS: readonly PublisherScraper[] = [vizScraper, kodanshaScraper];
```

Replace with:

```ts
const SCRAPERS: readonly PublisherScraper[] = [
  vizScraper,
  kodanshaScraper,
  yenpressScraper,
];
```

- [ ] **Step 3: Run the full test suite**

```bash
pnpm test
pnpm lint:types
```

Expected: all suites pass — no lookup tests need new fixtures because existing tests exercise the registry generically.

- [ ] **Step 4: Commit**

```bash
git add plugins/manga-enricher/src/lookup.ts
git commit -m "[Feature] Register Yen Press scraper in lookup registry"
```

---

## Task 11: Update the manifest

Grant network access to `yenpress.com` and `images.yenpress.com` and update capability descriptions.

**Files:**
- Modify: `plugins/manga-enricher/manifest.json`

- [ ] **Step 1: Extend `httpAccess.domains`**

In `manifest.json`, find:

```json
"domains": [
  "api.mangaupdates.com",
  "cdn.mangaupdates.com",
  "www.viz.com",
  "dw9to29mmj727.cloudfront.net",
  "kodansha.us",
  "production.image.azuki.co"
],
```

Replace with:

```json
"domains": [
  "api.mangaupdates.com",
  "cdn.mangaupdates.com",
  "www.viz.com",
  "dw9to29mmj727.cloudfront.net",
  "kodansha.us",
  "production.image.azuki.co",
  "yenpress.com",
  "images.yenpress.com"
],
```

- [ ] **Step 2: Update the `metadataEnricher` description**

Find:

```json
"description": "Fetches manga metadata from MangaUpdates and scrapes per-volume details from Viz and Kodansha USA",
```

Replace with:

```json
"description": "Fetches manga metadata from MangaUpdates and scrapes per-volume details from Viz, Kodansha USA, and Yen Press",
```

- [ ] **Step 3: Update the plugin-level description**

Find:

```json
"description": "Enriches manga metadata from MangaUpdates and publisher websites (Viz, Kodansha USA)",
```

Replace with:

```json
"description": "Enriches manga metadata from MangaUpdates and publisher websites (Viz, Kodansha USA, Yen Press)",
```

- [ ] **Step 4: Update the `httpAccess` capability description**

Find:

```json
"description": "Calls the MangaUpdates API and scrapes Viz Media and Kodansha USA product pages",
```

Replace with:

```json
"description": "Calls the MangaUpdates API and scrapes Viz Media, Kodansha USA, and Yen Press product pages",
```

- [ ] **Step 5: Run the full check suite**

```bash
pnpm check
```

Expected: lint + tests all pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/manga-enricher/manifest.json
git commit -m "[Feature] Grant Yen Press domains in manifest"
```

---

## Task 12: Update the plugin changelog

Record the Yen Press addition in the manga-enricher changelog under an Unreleased section so the next release picks it up.

**Files:**
- Modify: `plugins/manga-enricher/CHANGELOG.md`

- [ ] **Step 1: Read the current changelog**

```bash
cat plugins/manga-enricher/CHANGELOG.md
```

Note the existing format so the new entry matches.

- [ ] **Step 2: Add an Unreleased section**

Insert at the top of the changelog (below the `# Changelog` heading if one exists; otherwise as the first entry), following the existing format. Example (adjust shape to match existing entries):

```markdown
## Unreleased

- Add Yen Press publisher scraper: per-volume metadata (ISBN, release date, imprint, description, cover) for series licensed by Yen Press.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/manga-enricher/CHANGELOG.md
git commit -m "[Docs] manga-enricher changelog: Yen Press scraper"
```

---

## Task 13: Final verification

Run the full lint + test suite one last time end-to-end.

- [ ] **Step 1: Run `pnpm check`**

```bash
pnpm check
```

Expected: all suites pass — ESLint clean, Prettier clean, TypeScript clean, vitest green.

- [ ] **Step 2: Build to confirm the module compiles into the bundle**

```bash
pnpm build
```

Expected: no errors; `dist/manga-enricher/main.js` is produced.

- [ ] **Step 3: Sanity-check that the bundle contains the new scraper**

```bash
grep -c "Yen Press" dist/manga-enricher/main.js
```

Expected: count ≥ 1 (the scraper's `name` string and user-agent/log strings should appear in the IIFE bundle).

- [ ] **Step 4: Review the commits**

```bash
git log --oneline origin/master..HEAD
```

Expected: roughly 11 commits covering fixtures, skeleton, slug, picker, date, parseProduct steps, searchVolume, registry, manifest, changelog.

No commit needed in this task — it's verification only.

---

## Self-review notes

Covered spec requirements:
- Module under `src/publishers/yenpress.ts` with `PublisherScraper` (T3/T9)
- Slug rule with edition append (T4)
- Series-page fetch + product-path regex (T5, T9)
- Date parser with short/long month names (T6)
- Description and cover extraction (T7)
- Detail-box helper, digital-ISBN preference, release date, imprint (T8)
- `searchVolume` two-step flow with null-safe failure (T9)
- Registry registration (T10)
- Manifest domain grants and description updates (T11)
- Changelog entry (T12)
- Full `pnpm check` + build verification (T13)

Out of scope per spec: Yen On, JY, Ize Press, J-Novel Club (narrow `matchPublisher`), subtitle field, Page Count / Trim Size, search-API reverse-engineering.
