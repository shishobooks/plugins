# Seven Seas scraper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Seven Seas Entertainment per-volume scraper to `manga-enricher` so volumes published by Seven Seas get ISBN, release date, imprint, description, and cover URL filled in from `sevenseasentertainment.com`.

**Architecture:** Direct URL construction (no series-page probe). `searchVolume` slugifies the title, builds `/books/<slug>-vol-<N>/` (or the 2-in-1 omnibus variant), fetches, and parses the product page. Parsing uses a mix of `shisho.html` DOM queries (cover, imprint) and raw-HTML regex (labelled ISBN/date fields) to survive two coexisting site-template generations (`gomanga2017/2020` vs `gomanga2025`).

**Tech Stack:** TypeScript, esbuild IIFE output, goja runtime, `shisho.html` parser, vitest, `@shisho-plugins/shared` (`stripHTML`), `@shisho/plugin-sdk` types.

**Spec:** `docs/superpowers/specs/2026-04-13-seven-seas-scraper-design.md`

---

## File Structure

**New files:**
- `plugins/manga-enricher/src/publishers/sevenseas.ts` — scraper module. Public exports: `slugify`, `buildProductPath`, `parseSevenSeasDate`, `parseProduct`, `sevenseasScraper`. Private: `fetchHtml`, regex helpers, constants.
- `plugins/manga-enricher/src/__tests__/sevenseas.test.ts` — unit + integration tests mirroring `yenpress.test.ts`'s structure.
- `plugins/manga-enricher/src/__tests__/fixtures/sevenseas-365-days-vol1.html` — old template, `November 14, 2023` date, `979-8-` ISBN, no imprint. **Already saved on disk** (see Task 1).
- `plugins/manga-enricher/src/__tests__/fixtures/sevenseas-tokyo-revengers-omnibus-vol1-2.html` — old template, `2022/07/26` slash date, `978-` ISBN, exercises the 2-in-1 omnibus URL pattern. **Already saved on disk.**
- `plugins/manga-enricher/src/__tests__/fixtures/sevenseas-25dim-seduction-vol1.html` — new `gomanga2025` template, `February 8, 2022` date, Ghost Ship sub-imprint label. **Already saved on disk.**

**Modified files:**
- `plugins/manga-enricher/src/lookup.ts:11` — add `import { sevenseasScraper } from "./publishers/sevenseas";`
- `plugins/manga-enricher/src/lookup.ts:27-31` — append `sevenseasScraper` to the `SCRAPERS` readonly array.

**Unchanged but referenced:**
- `plugins/manga-enricher/src/publishers/types.ts` — `PublisherScraper` and `VolumeMetadata` contracts.
- `plugins/manga-enricher/src/publishers/yenpress.ts` — reference for `MONTHS` table, description-cleanup regex patterns, `mockFetchSequence` pattern.
- `plugins/manga-enricher/src/publishers/kodansha.ts` — reference for the direct-URL-construction flow.
- `test/setup.ts` — global `shisho` mock; `shisho.http.fetch` is a `vi.fn()` that gets reset per test.

---

## Task 1: Commit the fixtures

**Files:**
- Create (already on disk, needs commit): `plugins/manga-enricher/src/__tests__/fixtures/sevenseas-365-days-vol1.html`
- Create (already on disk, needs commit): `plugins/manga-enricher/src/__tests__/fixtures/sevenseas-tokyo-revengers-omnibus-vol1-2.html`
- Create (already on disk, needs commit): `plugins/manga-enricher/src/__tests__/fixtures/sevenseas-25dim-seduction-vol1.html`

The fixtures have already been saved during investigation by fetching `web.archive.org` snapshots and stripping the archive prefixes from `src`/`href` attributes via `sed -E 's|https?://web\.archive\.org/web/[0-9]+([a-z]{2,4}_)?/||g'`. A handful of `web.archive.org` references remain in inline-script strings and non-metadata regions; they're irrelevant to scraping and safe to leave.

- [ ] **Step 1: Verify the fixtures exist on disk**

```bash
ls -la plugins/manga-enricher/src/__tests__/fixtures/sevenseas-*.html
```

Expected: three files, sizes ~45KB / ~30KB / ~44KB (365-days / tokyo-revengers-omnibus / 25dim).

- [ ] **Step 2: Sanity-check that the key metadata markers are present**

```bash
for f in plugins/manga-enricher/src/__tests__/fixtures/sevenseas-*.html; do
  echo "=== $f ==="
  grep -o 'ISBN:</b>[^<]*' "$f" | head -1
  grep -o 'Release Date:</b>[^<]*' "$f" | head -1
done
```

Expected output (ISBN and date per fixture):
```
sevenseas-25dim-seduction-vol1.html
ISBN:</b> 978-1-64827-881-5
Release Date:</b> February 8, 2022
sevenseas-365-days-vol1.html
ISBN:</b> 979-8-88843-263-1
Release Date:</b> November 14, 2023
sevenseas-tokyo-revengers-omnibus-vol1-2.html
ISBN:</b> 978-1-63858-571-8
Release Date:</b> 2022/07/26
```

If any fixture is missing or any marker is blank, re-fetch from `https://web.archive.org/web/2024/https://sevenseasentertainment.com/books/<slug>/` and re-run the `sed` strip. **Do not proceed** until all three fixtures show both markers.

- [ ] **Step 3: Commit the fixtures**

```bash
git add plugins/manga-enricher/src/__tests__/fixtures/sevenseas-*.html
git commit -m "[Test] Add Seven Seas product page fixtures"
```

Commit the fixtures on their own so that later test-code commits have clean diffs.

---

## Task 2: Scaffold `sevenseas.ts` with `matchPublisher` (TDD)

**Files:**
- Create: `plugins/manga-enricher/src/publishers/sevenseas.ts`
- Create: `plugins/manga-enricher/src/__tests__/sevenseas.test.ts`

Start the module with only the regex-matching boundary. The scraper object will stub `searchVolume` returning `null` until Task 11, but `matchPublisher` gets its tests now.

- [ ] **Step 1: Write the failing `matchPublisher` test file**

Create `plugins/manga-enricher/src/__tests__/sevenseas.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sevenseasScraper } from "../publishers/sevenseas";
import { describe, expect, it, vi } from "vitest";

describe("sevenseasScraper.matchPublisher", () => {
  it("matches 'Seven Seas'", () => {
    expect(sevenseasScraper.matchPublisher("Seven Seas")).toBe(true);
  });

  it("matches 'Seven Seas Entertainment'", () => {
    expect(sevenseasScraper.matchPublisher("Seven Seas Entertainment")).toBe(
      true,
    );
  });

  it("is case-insensitive", () => {
    expect(sevenseasScraper.matchPublisher("seven seas")).toBe(true);
  });

  it("tolerates extra whitespace between words", () => {
    expect(sevenseasScraper.matchPublisher("Seven  Seas")).toBe(true);
  });

  it("does not match unrelated publishers", () => {
    expect(sevenseasScraper.matchPublisher("Yen Press")).toBe(false);
    expect(sevenseasScraper.matchPublisher("Viz Media")).toBe(false);
    expect(sevenseasScraper.matchPublisher("Kodansha USA")).toBe(false);
  });

  it("does not match bare imprint names (known MVP limitation)", () => {
    // MangaUpdates sometimes lists Seven Seas sub-imprints as standalone
    // publishers ("Ghost Ship", "Airship", "Steamship"). The MVP scraper
    // only claims titles whose MU publisher string contains "Seven Seas".
    // Filed as a follow-up; this test documents the boundary.
    expect(sevenseasScraper.matchPublisher("Ghost Ship")).toBe(false);
    expect(sevenseasScraper.matchPublisher("Airship")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails with the expected error**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: FAIL with `Cannot find module '../publishers/sevenseas'` or similar.

- [ ] **Step 3: Create the scraper module stub**

Create `plugins/manga-enricher/src/publishers/sevenseas.ts`:

```ts
import type { PublisherScraper, VolumeMetadata } from "./types";

const USER_AGENT =
  "ShishoPlugin/0.1.0 (manga-enricher; github.com/shishobooks/plugins)";

const BASE_URL = "https://sevenseasentertainment.com";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fetchHtml(url: string): string | null {
  shisho.log.debug(`SevenSeas: fetching ${url}`);
  const response = shisho.http.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response || !response.ok) {
    shisho.log.warn(
      `SevenSeas: HTTP ${response?.status ?? "no response"} ${url}`,
    );
    return null;
  }
  try {
    return response.text();
  } catch {
    shisho.log.warn(`SevenSeas: failed to read response body for ${url}`);
    return null;
  }
}

export const sevenseasScraper: PublisherScraper = {
  name: "Seven Seas Entertainment",

  matchPublisher(publisherName: string): boolean {
    return /\bseven\s+seas\b/i.test(publisherName);
  },

  searchVolume(
    _seriesTitle: string,
    _volumeNumber: number,
    _edition?: string,
  ): VolumeMetadata | null {
    // Filled in at Task 11.
    return null;
  },
};
```

The `_`-prefixed unused params follow the project's ESLint convention (`no-unused-vars` allows `_`-prefix). The `fetchHtml` helper is defined now so subsequent tasks can use it without churn; the eslint-disable comment is removed in Task 11 when `searchVolume` starts calling it.

- [ ] **Step 4: Run the `matchPublisher` tests**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: 6 tests pass (one `describe` with 6 `it`s).

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/sevenseas.ts \
        plugins/manga-enricher/src/__tests__/sevenseas.test.ts
git commit -m "[Feature] Seven Seas scraper: matchPublisher"
```

---

## Task 3: `slugify` helper (TDD)

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/sevenseas.ts`
- Modify: `plugins/manga-enricher/src/__tests__/sevenseas.test.ts`

- [ ] **Step 1: Add `slugify` tests**

Append this `describe` block to `sevenseas.test.ts` (right after the existing `matchPublisher` block, above everything else):

```ts
import { slugify } from "../publishers/sevenseas";

describe("slugify", () => {
  it("slugifies a plain series title", () => {
    expect(slugify("Monster Musume")).toBe("monster-musume");
  });

  it("collapses periods in numeric prefixes", () => {
    // Seven Seas: /books/2-5-dimensional-seduction-vol-1/
    expect(slugify("2.5 Dimensional Seduction")).toBe(
      "2-5-dimensional-seduction",
    );
  });

  it("drops ASCII apostrophes (Kodansha-style, not Yen Press-style)", () => {
    // Confirmed by /books/rozen-maiden-collectors-edition-vol-5/ (no stray
    // hyphen between "collector" and "s").
    expect(slugify("Rozen Maiden Collector's Edition")).toBe(
      "rozen-maiden-collectors-edition",
    );
  });

  it("drops Unicode right-single-quote (U+2019)", () => {
    expect(slugify("Rozen Maiden Collector\u2019s Edition")).toBe(
      "rozen-maiden-collectors-edition",
    );
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  !Hello World!  ")).toBe("hello-world");
  });

  it("returns empty string for punctuation-only input", () => {
    expect(slugify("!!!")).toBe("");
  });
});
```

The existing `import { sevenseasScraper }` line should be extended to also import `slugify` — keep the imports alphabetized within the list.

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: FAIL with `slugify is not exported` or `slugify is not a function`.

- [ ] **Step 3: Implement `slugify`**

Add to `plugins/manga-enricher/src/publishers/sevenseas.ts`, immediately after the `fetchHtml` helper:

```ts
/**
 * Slugify a title for Seven Seas' URL scheme: lowercase, drop both ASCII
 * and Unicode right-single-quotes, replace non-alphanumeric runs with a
 * single hyphen, trim leading/trailing hyphens. The apostrophe-drop
 * matches Kodansha and the live Seven Seas slugs (verified by
 * /books/rozen-maiden-collectors-edition-vol-5/), and differs from Yen
 * Press, which turns apostrophes into hyphens.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

- [ ] **Step 4: Run the test to confirm pass**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: all `matchPublisher` + `slugify` tests pass (12 total).

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/sevenseas.ts \
        plugins/manga-enricher/src/__tests__/sevenseas.test.ts
git commit -m "[Feature] Seven Seas scraper: slugify"
```

---

## Task 4: `buildProductPath` — standard, edition, and omnibus URL construction (TDD)

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/sevenseas.ts`
- Modify: `plugins/manga-enricher/src/__tests__/sevenseas.test.ts`

This helper owns the "which URL are we fetching" decision. Exporting it lets us unit-test the edition + omnibus logic without stubbing `shisho.http.fetch`.

- [ ] **Step 1: Add `buildProductPath` tests**

Extend the import at the top of `sevenseas.test.ts` to include `buildProductPath`, then append:

```ts
describe("buildProductPath", () => {
  it("builds a plain volume path", () => {
    expect(buildProductPath("Monster Musume", 1)).toBe(
      "/books/monster-musume-vol-1/",
    );
  });

  it("appends a non-omnibus edition to the slug", () => {
    expect(buildProductPath("Rozen Maiden", 5, "Collector's Edition")).toBe(
      "/books/rozen-maiden-collectors-edition-vol-5/",
    );
  });

  it("builds a 2-in-1 omnibus range URL (omnibus sequence 1 → vols 1-2)", () => {
    expect(buildProductPath("Tokyo Revengers", 1, "Omnibus")).toBe(
      "/books/tokyo-revengers-omnibus-vol-1-2/",
    );
  });

  it("builds a 2-in-1 omnibus range URL (omnibus sequence 3 → vols 5-6)", () => {
    expect(buildProductPath("Tokyo Revengers", 3, "Omnibus")).toBe(
      "/books/tokyo-revengers-omnibus-vol-5-6/",
    );
  });

  it("detects 'omnibus' case-insensitively", () => {
    expect(buildProductPath("Tokyo Revengers", 1, "omnibus")).toBe(
      "/books/tokyo-revengers-omnibus-vol-1-2/",
    );
  });

  it("does NOT fold an omnibus edition into the slug", () => {
    // The slug is the base series slug; the "-omnibus-" segment is
    // injected separately. Verifies we don't produce
    // /books/tokyo-revengers-omnibus-omnibus-vol-1-2/.
    const path = buildProductPath("Tokyo Revengers", 1, "Omnibus");
    expect(path).not.toMatch(/-omnibus-omnibus-/);
  });

  it("returns null when the slug is empty (punctuation-only title)", () => {
    expect(buildProductPath("!!!", 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: FAIL with `buildProductPath is not a function`.

- [ ] **Step 3: Implement `buildProductPath`**

Add to `sevenseas.ts`, after `slugify`:

```ts
/**
 * Build the product-page path for a Seven Seas volume.
 *
 * For non-omnibus requests: `/books/<slug>-vol-<N>/`. The edition (if
 * any, e.g. "Collector's Edition") is appended to the series title before
 * slugifying, matching Yen Press's approach.
 *
 * For omnibus requests (edition contains "omnibus" case-insensitively):
 * `/books/<base-slug>-omnibus-vol-<2N-1>-<2N>/`. Only the 2-in-1 form is
 * handled — Seven Seas' observed omnibus slugs always pair two volumes
 * (Tokyo Revengers Omnibus 1 = vols 1-2, etc.). Three-in-one omnibuses
 * exist but are not handled in this MVP (see follow-up tasks in the spec).
 *
 * Returns null when the title slugifies to an empty string so that
 * punctuation-only queries don't reach the network.
 */
export function buildProductPath(
  seriesTitle: string,
  volumeNumber: number,
  edition?: string,
): string | null {
  const isOmnibus = edition !== undefined && /omnibus/i.test(edition);
  const slugSource =
    edition && !isOmnibus ? `${seriesTitle} ${edition}` : seriesTitle;
  const slug = slugify(slugSource);
  if (!slug) return null;

  if (isOmnibus) {
    const first = 2 * volumeNumber - 1;
    const second = 2 * volumeNumber;
    return `/books/${slug}-omnibus-vol-${first}-${second}/`;
  }

  return `/books/${slug}-vol-${volumeNumber}/`;
}
```

- [ ] **Step 4: Run the tests to confirm pass**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: all prior + 7 new `buildProductPath` tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/sevenseas.ts \
        plugins/manga-enricher/src/__tests__/sevenseas.test.ts
git commit -m "[Feature] Seven Seas scraper: buildProductPath (standard, edition, omnibus)"
```

---

## Task 5: `parseSevenSeasDate` — both month-name and YYYY/MM/DD formats (TDD)

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/sevenseas.ts`
- Modify: `plugins/manga-enricher/src/__tests__/sevenseas.test.ts`

- [ ] **Step 1: Add `parseSevenSeasDate` tests**

Extend imports to include `parseSevenSeasDate`, then append:

```ts
describe("parseSevenSeasDate", () => {
  it("parses long month names", () => {
    expect(parseSevenSeasDate("November 14, 2023")).toBe(
      "2023-11-14T00:00:00Z",
    );
  });

  it("parses short month names", () => {
    expect(parseSevenSeasDate("Nov 14, 2023")).toBe("2023-11-14T00:00:00Z");
  });

  it("parses YYYY/MM/DD slash format (old template)", () => {
    expect(parseSevenSeasDate("2022/07/26")).toBe("2022-07-26T00:00:00Z");
  });

  it("parses YYYY/M/D slash format with single digits", () => {
    expect(parseSevenSeasDate("2013/1/5")).toBe("2013-01-05T00:00:00Z");
  });

  it("zero-pads single-digit days in month-name format", () => {
    expect(parseSevenSeasDate("Feb 3, 2020")).toBe("2020-02-03T00:00:00Z");
  });

  it("tolerates extra whitespace", () => {
    expect(parseSevenSeasDate("  November  14 , 2023 ")).toBe(
      "2023-11-14T00:00:00Z",
    );
  });

  it("returns undefined for unparseable input", () => {
    expect(parseSevenSeasDate("")).toBeUndefined();
    expect(parseSevenSeasDate("TBA")).toBeUndefined();
    // ISO-dash format is NOT accepted — Seven Seas doesn't produce it,
    // and accepting it would mask upstream bugs.
    expect(parseSevenSeasDate("2022-07-26")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: FAIL with `parseSevenSeasDate is not a function`.

- [ ] **Step 3: Implement `parseSevenSeasDate`**

Add to `sevenseas.ts`, after `buildProductPath`:

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
 * Parse a Seven Seas date string into ISO 8601 (midnight UTC). Two
 * formats are accepted, corresponding to the two site template
 * generations we've observed:
 *
 *   1. "November 14, 2023" — newer (gomanga2025) pages. Same shape as
 *      Yen Press, which is why we reuse the same MONTHS table.
 *   2. "2022/07/26" — older (gomanga2017/2020) pages. YYYY/MM/DD with
 *      numeric slashes. Single-digit months and days are tolerated.
 *
 * Dash-separated ISO dates are deliberately NOT accepted — Seven Seas
 * never emits them, and accepting them would mask upstream bugs where
 * already-parsed ISO dates get round-tripped back through here.
 *
 * Returns undefined on any input that doesn't match either format.
 */
export function parseSevenSeasDate(dateStr: string): string | undefined {
  const normalized = dateStr.replace(/\s+/g, " ").trim();

  // Slash format: 2022/07/26 or 2013/1/5
  const slashMatch = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const [, year, month, day] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00Z`;
  }

  // Month-name format: November 14, 2023 / Nov 14, 2023
  const wordMatch = normalized.match(/^([A-Za-z]+)\s+(\d{1,2})\s*,\s*(\d{4})$/);
  if (wordMatch) {
    const month = MONTHS[wordMatch[1].toLowerCase()];
    if (!month) return undefined;
    const day = wordMatch[2].padStart(2, "0");
    return `${wordMatch[3]}-${month}-${day}T00:00:00Z`;
  }

  return undefined;
}
```

- [ ] **Step 4: Run the tests to confirm pass**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: all prior + 7 new date tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/sevenseas.ts \
        plugins/manga-enricher/src/__tests__/sevenseas.test.ts
git commit -m "[Feature] Seven Seas scraper: date parser (both formats)"
```

---

## Task 6: `parseProduct` skeleton + cover extraction (TDD)

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/sevenseas.ts`
- Modify: `plugins/manga-enricher/src/__tests__/sevenseas.test.ts`

Start the product-page parser with just the `url` and `coverUrl` fields. Subsequent tasks extend the same function.

- [ ] **Step 1: Add fixture loader and `parseProduct — cover` tests**

At the top of `sevenseas.test.ts`, below the existing imports, add the fixture readers:

```ts
const daysSeries365Html = readFileSync(
  resolve(__dirname, "fixtures/sevenseas-365-days-vol1.html"),
  "utf-8",
);

const tokyoRevengersOmnibusHtml = readFileSync(
  resolve(__dirname, "fixtures/sevenseas-tokyo-revengers-omnibus-vol1-2.html"),
  "utf-8",
);

const dim25Html = readFileSync(
  resolve(__dirname, "fixtures/sevenseas-25dim-seduction-vol1.html"),
  "utf-8",
);
```

Extend imports to include `parseProduct`, then append:

```ts
describe("parseProduct — cover and url plumbing", () => {
  const daysUrl =
    "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/";

  it("sets the url field to the passed-in value", () => {
    const result = parseProduct(daysSeries365Html, daysUrl);
    expect(result?.url).toBe(daysUrl);
  });

  it("extracts the cover URL from #volume-cover img[src]", () => {
    const result = parseProduct(daysSeries365Html, daysUrl);
    expect(result?.coverUrl).toBe(
      "https://sevenseasentertainment.com/wp-content/uploads/2023/07/365ToWeddingM1_site.jpg",
    );
  });

  it("extracts cover for the old-template omnibus fixture", () => {
    const url =
      "https://sevenseasentertainment.com/books/tokyo-revengers-omnibus-vol-1-2/";
    const result = parseProduct(tokyoRevengersOmnibusHtml, url);
    expect(result?.coverUrl).toBe(
      "https://sevenseasentertainment.com/wp-content/uploads/2022/02/tokyorevengers1-2_site.jpg",
    );
  });

  it("extracts cover for the new-template Ghost Ship fixture", () => {
    const url =
      "https://sevenseasentertainment.com/books/2-5-dimensional-seduction-vol-1/";
    const result = parseProduct(dim25Html, url);
    expect(result?.coverUrl).toBe(
      "https://sevenseasentertainment.com/wp-content/uploads/2021/12/2.5-Dimensional-Seduction1_site.jpg",
    );
  });

  it("omits coverUrl when the page has no #volume-cover element", () => {
    const result = parseProduct("<html><body></body></html>", "https://x/");
    expect(result).not.toBeNull();
    expect(result?.url).toBe("https://x/");
    expect(result?.coverUrl).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: FAIL with `parseProduct is not a function`.

- [ ] **Step 3: Implement `parseProduct` skeleton + cover extraction**

Add to `sevenseas.ts`, after `parseSevenSeasDate`:

```ts
/**
 * Extract the per-volume cover URL from a Seven Seas product page.
 *
 * Seven Seas renders the cover as `<div id="volume-cover"><img src="...">`
 * with an absolute URL in the `src` attribute — no lazy-load shenanigans
 * to unwind. We use the attribute directly when it starts with "http".
 */
function extractCover(
  doc: ReturnType<typeof shisho.html.parse>,
): string | undefined {
  const img = shisho.html.querySelector(doc, "div#volume-cover img");
  const src = img?.attributes.src;
  return src && src.startsWith("http") ? src : undefined;
}

/**
 * Parse a Seven Seas product page into VolumeMetadata. Always returns
 * at least `{ url }` — fields that cannot be extracted are simply
 * omitted. The `| null` return type is reserved for a future error-page
 * detection path; the current implementation never returns null.
 */
export function parseProduct(html: string, url: string): VolumeMetadata | null {
  const doc = shisho.html.parse(html);
  const metadata: VolumeMetadata = { url };

  const coverUrl = extractCover(doc);
  if (coverUrl) metadata.coverUrl = coverUrl;

  return metadata;
}
```

- [ ] **Step 4: Run the tests to confirm pass**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: all prior + 5 new parseProduct cover tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/sevenseas.ts \
        plugins/manga-enricher/src/__tests__/sevenseas.test.ts
git commit -m "[Feature] Seven Seas scraper: parseProduct cover extraction"
```

---

## Task 7: `parseProduct` — sub-imprint label (TDD)

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/sevenseas.ts`
- Modify: `plugins/manga-enricher/src/__tests__/sevenseas.test.ts`

Sub-imprint labels use `<div class="age-rating" id="XX-block">`, where `XX` is a 2-letter code (`GS` = Ghost Ship, `SS` = Steamship, plausibly `AS`/`DM`/`WC`/`SI` for Airship/Danmei/Waves of Color/Siren). The age-rating badge (`id="teen"`, `id="olderteen15"`) shares the `.age-rating` class but has no `-block` id, so we filter by id suffix.

- [ ] **Step 1: Add imprint tests**

Append to `sevenseas.test.ts`:

```ts
describe("parseProduct — imprint", () => {
  it("extracts 'Ghost Ship' from the #GS-block div (nested <a>)", () => {
    const result = parseProduct(
      dim25Html,
      "https://sevenseasentertainment.com/books/2-5-dimensional-seduction-vol-1/",
    );
    expect(result?.imprint).toBe("Ghost Ship");
  });

  it("extracts a plain-text imprint from the #SS-block div", () => {
    // Synthetic HTML — the Steamship fixture (Ladies on Top) isn't
    // included as a full fixture since Ghost Ship already exercises the
    // nested-<a> variant; this test covers the plain-text sibling shape
    // (<div id="SS-block" class="age-rating">Steamship</div>) that the
    // old template uses when the label is unlinked.
    const html = `
      <html><body>
        <div id="volume-cover">
          <img src="https://sevenseasentertainment.com/cover.jpg">
          <div id="SS-block" class="age-rating">Steamship</div>
          <div class="age-rating" id="olderteen17"></div>
        </div>
      </body></html>
    `;
    const result = parseProduct(html, "https://sevenseasentertainment.com/x/");
    expect(result?.imprint).toBe("Steamship");
  });

  it("omits imprint when only the age-rating badge is present (main SS line)", () => {
    // The 365 Days fixture has <div class="age-rating" id="teen"></div>
    // but no -block sibling — this is the main Seven Seas line.
    const result = parseProduct(
      daysSeries365Html,
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    expect(result?.imprint).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: FAIL with `imprint` being `undefined` in Ghost Ship case.

- [ ] **Step 3: Implement imprint extraction**

Add to `sevenseas.ts`, immediately above the existing `extractCover`:

```ts
/**
 * Extract the sub-imprint label from a Seven Seas product page.
 *
 * Sub-imprints (Ghost Ship, Steamship, Airship, Danmei, etc.) render as
 * a sibling to the age-rating badge with the class `age-rating` and an
 * id of the form `<XX>-block` — e.g., `<div id="GS-block"
 * class="age-rating"><a href="...">Ghost Ship</a></div>`. The age-rating
 * badge itself also has `class="age-rating"` but uses ids like
 * `"teen"`, `"olderteen15"`, so we filter by id suffix to distinguish.
 *
 * Returns undefined for pages that only contain the rating badge (main
 * Seven Seas line with no sub-imprint).
 */
function extractImprint(
  doc: ReturnType<typeof shisho.html.parse>,
): string | undefined {
  const ratings = shisho.html.querySelectorAll(doc, "div.age-rating");
  for (const div of ratings) {
    const id = div.attributes.id ?? "";
    if (!id.endsWith("-block")) continue;
    const text = div.text.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return undefined;
}
```

Then extend `parseProduct` (between the coverUrl assignment and the return) to call it:

```ts
  const imprint = extractImprint(doc);
  if (imprint) metadata.imprint = imprint;
```

- [ ] **Step 4: Run the tests to confirm pass**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: all prior + 3 new imprint tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/sevenseas.ts \
        plugins/manga-enricher/src/__tests__/sevenseas.test.ts
git commit -m "[Feature] Seven Seas scraper: sub-imprint label extraction"
```

---

## Task 8: `parseProduct` — ISBN and release date via raw-HTML regex (TDD)

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/sevenseas.ts`
- Modify: `plugins/manga-enricher/src/__tests__/sevenseas.test.ts`

ISBN and release date are both rendered as `<b>Label:</b> value` within `#volume-meta`. The DOM wrapper differs between templates (single `<p>` with `<br>`s vs. one `<p>` per field), but the `<b>Label:</b> value` shape is invariant. A regex on the raw `#volume-meta` substring works cleanly across both templates and avoids fighting the parser's text-node handling.

- [ ] **Step 1: Add ISBN and release date tests**

Append:

```ts
describe("parseProduct — ISBN", () => {
  it("extracts 979-8 prefix ISBN (365 Days fixture)", () => {
    const result = parseProduct(
      daysSeries365Html,
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    expect(result?.isbn13).toBe("9798888432631");
  });

  it("extracts 978 prefix ISBN (Tokyo Revengers omnibus fixture)", () => {
    const result = parseProduct(
      tokyoRevengersOmnibusHtml,
      "https://sevenseasentertainment.com/books/tokyo-revengers-omnibus-vol-1-2/",
    );
    expect(result?.isbn13).toBe("9781638585718");
  });

  it("extracts ISBN from new-template fixture (2.5 Dim Seduction)", () => {
    const result = parseProduct(
      dim25Html,
      "https://sevenseasentertainment.com/books/2-5-dimensional-seduction-vol-1/",
    );
    expect(result?.isbn13).toBe("9781648278815");
  });

  it("omits ISBN when #volume-meta is absent", () => {
    const result = parseProduct("<html><body></body></html>", "https://x/");
    expect(result?.isbn13).toBeUndefined();
  });

  it("omits ISBN when the value is not 13 digits after hyphen stripping", () => {
    const html = `
      <html><body>
        <div id="volume-meta">
          <p><b>ISBN:</b> 123-456</p>
        </div>
        <div id="single-book-retailers"></div>
      </body></html>
    `;
    const result = parseProduct(html, "https://x/");
    expect(result?.isbn13).toBeUndefined();
  });
});

describe("parseProduct — release date", () => {
  it("parses the month-name date from the 365 Days fixture", () => {
    const result = parseProduct(
      daysSeries365Html,
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    expect(result?.releaseDate).toBe("2023-11-14T00:00:00Z");
  });

  it("parses the slash-format date from the Tokyo Revengers omnibus fixture", () => {
    const result = parseProduct(
      tokyoRevengersOmnibusHtml,
      "https://sevenseasentertainment.com/books/tokyo-revengers-omnibus-vol-1-2/",
    );
    expect(result?.releaseDate).toBe("2022-07-26T00:00:00Z");
  });

  it("parses the month-name date from the new-template fixture", () => {
    const result = parseProduct(
      dim25Html,
      "https://sevenseasentertainment.com/books/2-5-dimensional-seduction-vol-1/",
    );
    expect(result?.releaseDate).toBe("2022-02-08T00:00:00Z");
  });

  it("omits releaseDate when #volume-meta is absent", () => {
    const result = parseProduct("<html><body></body></html>", "https://x/");
    expect(result?.releaseDate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: FAIL — `isbn13` and `releaseDate` both undefined.

- [ ] **Step 3: Implement the raw-HTML label scanner and wire it in**

Add to `sevenseas.ts` above `extractImprint`:

```ts
/**
 * Slice the substring of the raw page HTML that corresponds to the
 * `#volume-meta` block — from the opening `<div id="volume-meta"` up to
 * (but not including) the next `<div id="single-book-retailers"` marker
 * (or end-of-document if that marker is missing).
 *
 * We use this instead of walking the DOM for two fields (ISBN, release
 * date) because the value lives as a text node *following* a `<b>` tag,
 * and the `<b>`'s parent differs between templates — `<p>` on new pages,
 * the containing `<div>` on old pages with `</br>` separators. A regex
 * against the raw slice is simpler and survives both layouts.
 *
 * Returns an empty string when the `#volume-meta` marker is absent, so
 * `extractLabeledValue` will cleanly produce `undefined` on pages that
 * don't look like Seven Seas product pages at all.
 */
function sliceVolumeMetaHtml(html: string): string {
  const startMarker = '<div id="volume-meta"';
  const endMarker = '<div id="single-book-retailers"';
  const start = html.indexOf(startMarker);
  if (start === -1) return "";
  const end = html.indexOf(endMarker, start);
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

/**
 * Find the value that follows a `<b>Label:</b>` within the volume-meta
 * HTML slice. Label matching is case-insensitive. Returns the trimmed
 * value (whitespace collapsed to single spaces) or undefined.
 *
 * The regex captures everything up to the next `<` character, which is
 * either the closing tag of the parent `<p>`, a `</br>` separator in the
 * old template, or the opening tag of the next field.
 */
function extractLabeledValue(
  metaHtml: string,
  label: string,
): string | undefined {
  if (!metaHtml) return undefined;
  const escapedLabel = label.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(
    `<b>\\s*${escapedLabel}\\s*:\\s*<\\/b>\\s*([^<]+)`,
    "i",
  );
  const match = metaHtml.match(re);
  if (!match) return undefined;
  const value = match[1].replace(/\s+/g, " ").trim();
  return value || undefined;
}
```

Then wire them into `parseProduct`, between the imprint block and the return:

```ts
  const metaHtml = sliceVolumeMetaHtml(html);

  const rawIsbn = extractLabeledValue(metaHtml, "ISBN");
  if (rawIsbn) {
    const cleaned = rawIsbn.replace(/-/g, "").replace(/\s+/g, "");
    if (/^\d{13}$/.test(cleaned)) metadata.isbn13 = cleaned;
  }

  const rawDate = extractLabeledValue(metaHtml, "Release Date");
  if (rawDate) {
    const parsed = parseSevenSeasDate(rawDate);
    if (parsed) metadata.releaseDate = parsed;
  }
```

- [ ] **Step 4: Run the tests to confirm pass**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: all prior + 5 new ISBN tests + 4 new release-date tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/sevenseas.ts \
        plugins/manga-enricher/src/__tests__/sevenseas.test.ts
git commit -m "[Feature] Seven Seas scraper: ISBN and release date extraction"
```

---

## Task 9: `parseProduct` — description (TDD)

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/sevenseas.ts`
- Modify: `plugins/manga-enricher/src/__tests__/sevenseas.test.ts`

The description lives inside `#volume-meta` as a sequence of `<p>` children that come after a `<p>` containing a row of U+25AA (▪) markers and end when `#single-book-retailers` begins. Some pages include a `<p class="bookcrew">` translator credits block between the fields and the separator — we drop that by class. On both templates the separator and description `<p>`s are direct children of `#volume-meta`.

Strategy: use the DOM (not raw HTML) for this one — we need to filter by class, distinguish child elements, and reconstruct plain text. `shisho.html` gives us a `.children` array where each node has `.tag`, `.attributes`, `.text`.

- [ ] **Step 1: Add description tests**

Append:

```ts
describe("parseProduct — description", () => {
  it("extracts the description from the 365 Days fixture", () => {
    const result = parseProduct(
      daysSeries365Html,
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    expect(result?.description).toMatch(/^A sweet .fake engagement. romance/);
    // Must contain both the tagline <strong> paragraph and the body.
    expect(result?.description).toContain("J.T.C. travel agency");
    // No HTML tags leaked through.
    expect(result?.description).not.toMatch(/</);
  });

  it("extracts the description from the Tokyo Revengers omnibus fixture", () => {
    const result = parseProduct(
      tokyoRevengersOmnibusHtml,
      "https://sevenseasentertainment.com/books/tokyo-revengers-omnibus-vol-1-2/",
    );
    expect(result?.description).toMatch(/^The critically acclaimed manga/);
    expect(result?.description).toContain("Hanagaki Takemichi");
  });

  it("extracts the description from the 2.5 Dim fixture (new template)", () => {
    const result = parseProduct(
      dim25Html,
      "https://sevenseasentertainment.com/books/2-5-dimensional-seduction-vol-1/",
    );
    expect(result?.description).toMatch(/^A hot-blooded romantic cosplay comedy/);
    expect(result?.description).toContain("Okumura");
  });

  it("drops the bookcrew (translator credits) paragraph", () => {
    const result = parseProduct(
      daysSeries365Html,
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    expect(result?.description).not.toContain("Kristjan Rohde");
    expect(result?.description).not.toContain("Translation");
  });

  it("joins multiple paragraphs with a blank line", () => {
    const result = parseProduct(
      daysSeries365Html,
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    // Tagline (<strong>) paragraph followed by body paragraph — verify
    // they are separated by a blank line, not run together.
    expect(result?.description).toMatch(/!\n\nThe J\.T\.C/);
  });

  it("omits description when #volume-meta is absent", () => {
    const result = parseProduct("<html><body></body></html>", "https://x/");
    expect(result?.description).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify failure**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: FAIL — description is undefined.

- [ ] **Step 3: Implement description extraction**

At the top of `sevenseas.ts`, change the imports to add `stripHTML`:

```ts
import type { PublisherScraper, VolumeMetadata } from "./types";
import { stripHTML } from "@shisho-plugins/shared";
```

Add this helper above `parseProduct`:

```ts
/**
 * Extract the per-volume synopsis from a Seven Seas product page.
 *
 * Within `<div id="volume-meta">`, Seven Seas renders fields (Series,
 * Story & Art, Release Date, ISBN) at the top, then a row-of-dots
 * separator paragraph (`<p>▪ ▪ ▪ …</p>` — U+25AA), then the synopsis as
 * a sequence of `<p>` children, ending at the retailers block. A
 * `<p class="bookcrew">` block with translator credits may appear
 * between the fields and the separator on some pages; we drop it by
 * class (and anything else before the separator).
 *
 * We walk `#volume-meta`'s direct children, find the separator `<p>`
 * (text starts with U+25AA), collect every `<p>` child after it that
 * isn't `class="bookcrew"`, concatenate their `.text`, and run the
 * result through `stripHTML` to neutralize any residual markup. Multiple
 * paragraphs are joined with `\n\n`.
 */
function extractDescription(
  doc: ReturnType<typeof shisho.html.parse>,
): string | undefined {
  const meta = shisho.html.querySelector(doc, "div#volume-meta");
  if (!meta) return undefined;

  const children = meta.children ?? [];
  let separatorIndex = -1;
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c.tag !== "p") continue;
    if (c.text.trim().startsWith("\u25AA")) {
      separatorIndex = i;
      break;
    }
  }
  if (separatorIndex === -1) return undefined;

  const paragraphs: string[] = [];
  for (let i = separatorIndex + 1; i < children.length; i++) {
    const c = children[i];
    if (c.tag !== "p") continue;
    const cls = c.attributes.class ?? "";
    if (cls.includes("bookcrew")) continue;
    const text = c.text.replace(/\s+/g, " ").trim();
    if (text) paragraphs.push(text);
  }
  if (paragraphs.length === 0) return undefined;

  const cleaned = stripHTML(paragraphs.join("\n\n")).trim();
  return cleaned || undefined;
}
```

Wire it into `parseProduct` (between the release-date block and the `return`):

```ts
  const description = extractDescription(doc);
  if (description) metadata.description = description;
```

- [ ] **Step 4: Run the tests to confirm pass**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: all prior + 6 new description tests pass.

If the `description` field contains stray "&amp;" entities or similar that cause a substring match to fail, note that `.text` on `shisho.html` nodes already decodes HTML entities — but right-single-quote characters (U+2019) may show up in the decoded text where a regex expects a plain ASCII apostrophe. The test uses `.` in `"fake engagement"` to tolerate whichever quote style is produced.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/sevenseas.ts \
        plugins/manga-enricher/src/__tests__/sevenseas.test.ts
git commit -m "[Feature] Seven Seas scraper: description extraction"
```

---

## Task 10: Empty-page and "omits missing fields" regression test

**Files:**
- Modify: `plugins/manga-enricher/src/__tests__/sevenseas.test.ts`

The individual field tests each cover the "missing" case for their own field. This task consolidates a one-shot "the whole parser is graceful on garbage input" regression so that future refactors don't regress the null-safety.

- [ ] **Step 1: Add the consolidated test**

Append:

```ts
describe("parseProduct — graceful failure", () => {
  it("returns { url } for completely empty HTML", () => {
    const result = parseProduct("", "https://x/");
    expect(result).not.toBeNull();
    expect(result?.url).toBe("https://x/");
    expect(result?.coverUrl).toBeUndefined();
    expect(result?.imprint).toBeUndefined();
    expect(result?.isbn13).toBeUndefined();
    expect(result?.releaseDate).toBeUndefined();
    expect(result?.description).toBeUndefined();
  });

  it("returns { url } for a page with only a 404 body", () => {
    const result = parseProduct(
      "<html><body><h1>404 Not Found</h1></body></html>",
      "https://x/",
    );
    expect(result?.url).toBe("https://x/");
    expect(result?.isbn13).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: PASS (no implementation change needed — this is a regression guard).

- [ ] **Step 3: Commit**

```bash
git add plugins/manga-enricher/src/__tests__/sevenseas.test.ts
git commit -m "[Test] Seven Seas scraper: graceful-failure regression"
```

---

## Task 11: `searchVolume` — wire parseProduct to the fetch layer (TDD)

**Files:**
- Modify: `plugins/manga-enricher/src/publishers/sevenseas.ts`
- Modify: `plugins/manga-enricher/src/__tests__/sevenseas.test.ts`

This replaces the `return null` stub in `searchVolume` and removes the `eslint-disable` from `fetchHtml`.

- [ ] **Step 1: Add the `searchVolume` integration tests**

Append to `sevenseas.test.ts`:

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

describe("sevenseasScraper.searchVolume", () => {
  it("fetches the product page directly and returns merged metadata", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: daysSeries365Html },
    ]);

    const result = sevenseasScraper.searchVolume(
      "365 Days to the Wedding",
      1,
    );

    expect(result).not.toBeNull();
    expect(result?.url).toBe(
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    expect(result?.isbn13).toBe("9798888432631");
    expect(result?.releaseDate).toBe("2023-11-14T00:00:00Z");

    const calls = vi.mocked(shisho.http.fetch).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
  });

  it("constructs the 2-in-1 omnibus URL when edition is 'Omnibus'", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: tokyoRevengersOmnibusHtml },
    ]);

    const result = sevenseasScraper.searchVolume(
      "Tokyo Revengers",
      1,
      "Omnibus",
    );

    expect(result?.isbn13).toBe("9781638585718");
    const calls = vi.mocked(shisho.http.fetch).mock.calls;
    expect(calls[0][0]).toBe(
      "https://sevenseasentertainment.com/books/tokyo-revengers-omnibus-vol-1-2/",
    );
  });

  it("folds a non-omnibus edition into the slug", () => {
    mockFetchSequence([{ status: 404, ok: false, body: "" }]);

    sevenseasScraper.searchVolume("Rozen Maiden", 5, "Collector's Edition");

    const calls = vi.mocked(shisho.http.fetch).mock.calls;
    expect(calls[0][0]).toBe(
      "https://sevenseasentertainment.com/books/rozen-maiden-collectors-edition-vol-5/",
    );
  });

  it("returns null when the product page 404s", () => {
    mockFetchSequence([{ status: 404, ok: false, body: "" }]);
    expect(sevenseasScraper.searchVolume("No Such Series", 1)).toBeNull();
  });

  it("returns null when the fetch helper returns null (network error)", () => {
    const mock = vi.mocked(shisho.http.fetch);
    mock.mockReset();
    mock.mockReturnValueOnce(
      null as unknown as ReturnType<typeof shisho.http.fetch>,
    );
    expect(sevenseasScraper.searchVolume("Some Series", 1)).toBeNull();
  });

  it("returns null for punctuation-only or empty titles without fetching", () => {
    const mock = vi.mocked(shisho.http.fetch);
    mock.mockReset();
    expect(sevenseasScraper.searchVolume("", 1)).toBeNull();
    expect(sevenseasScraper.searchVolume("!!!", 1)).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: the happy-path and omnibus tests FAIL because `searchVolume` still returns `null`.

- [ ] **Step 3: Implement `searchVolume`**

In `sevenseas.ts`, replace the stub `searchVolume` method with:

```ts
  searchVolume(
    seriesTitle: string,
    volumeNumber: number,
    edition?: string,
  ): VolumeMetadata | null {
    const path = buildProductPath(seriesTitle, volumeNumber, edition);
    if (!path) return null;

    const url = `${BASE_URL}${path}`;
    const html = fetchHtml(url);
    if (!html) return null;

    return parseProduct(html, url);
  },
```

Remove the `// eslint-disable-next-line @typescript-eslint/no-unused-vars` comment above `fetchHtml` (`searchVolume` now consumes it).

- [ ] **Step 4: Run the tests to confirm pass**

```bash
pnpm --filter manga-enricher test -- --run sevenseas.test.ts
```

Expected: all `searchVolume` tests pass (6 new). All prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/publishers/sevenseas.ts \
        plugins/manga-enricher/src/__tests__/sevenseas.test.ts
git commit -m "[Feature] Seven Seas scraper: searchVolume integration"
```

---

## Task 12: Register `sevenseasScraper` in the lookup registry

**Files:**
- Modify: `plugins/manga-enricher/src/lookup.ts` (import line and `SCRAPERS` array)

- [ ] **Step 1: Review the current registry**

Read lines 9-32 of `plugins/manga-enricher/src/lookup.ts`. The relevant chunk:

```ts
import { kodanshaScraper } from "./publishers/kodansha";
import type { PublisherScraper, VolumeMetadata } from "./publishers/types";
import { vizScraper } from "./publishers/viz";
import { yenpressScraper } from "./publishers/yenpress";
...
/** Registry of publisher scrapers. Order matters for the fallback path. */
const SCRAPERS: readonly PublisherScraper[] = [
  vizScraper,
  kodanshaScraper,
  yenpressScraper,
];
```

- [ ] **Step 2: Add the import**

The file already uses alphabetical order within the `./publishers/*` group: `kodansha`, `types`, `viz`, `yenpress`. The new import goes between `kodansha` and `types`:

```ts
import { kodanshaScraper } from "./publishers/kodansha";
import { sevenseasScraper } from "./publishers/sevenseas";
import type { PublisherScraper, VolumeMetadata } from "./publishers/types";
import { vizScraper } from "./publishers/viz";
import { yenpressScraper } from "./publishers/yenpress";
```

If Prettier's import-ordering plugin rearranges on save, accept its output.

- [ ] **Step 3: Append to the `SCRAPERS` array**

```ts
const SCRAPERS: readonly PublisherScraper[] = [
  vizScraper,
  kodanshaScraper,
  yenpressScraper,
  sevenseasScraper,
];
```

- [ ] **Step 4: Check for any lookup-test failures**

```bash
pnpm --filter manga-enricher test -- --run lookup.test.ts
```

Expected: PASS. `lookup.test.ts` does not currently assert on the exact `SCRAPERS` contents — it tests the title-matching and fallback logic via mocks — so this change should be invisible to it. If a test fails because it enumerates publishers, update the expectation.

- [ ] **Step 5: Commit**

```bash
git add plugins/manga-enricher/src/lookup.ts
git commit -m "[Feature] Register Seven Seas scraper in lookup"
```

---

## Task 13: Run `pnpm check` and fix anything it flags

**Files:** any

`pnpm check` runs lint (ESLint, Prettier, tsc) plus the full vitest suite. This is the same gate CI enforces.

- [ ] **Step 1: Run the full check from the repo root**

```bash
pnpm check
```

- [ ] **Step 2: If `pnpm lint:eslint` flags something, fix and re-run**

Most likely offenders:
- Unused variables → prefix with `_`
- `no-explicit-any` in the mocked `shisho.http.fetch` return — already handled in the test via `as unknown as ReturnType<typeof shisho.http.fetch>`; copy the exact shape from `yenpress.test.ts` if it complains.
- Import ordering → run `pnpm lint:prettier --write` (or let Prettier rewrite the file).

- [ ] **Step 3: If `pnpm lint:types` flags something, fix and re-run**

Most likely:
- `doc.children` may need a type assertion if the SDK's `Node` type doesn't universally expose `.children`. Look at how `yenpress.ts::extractDetailValue` uses `box.children` — that compiles, so mirror its pattern exactly.
- `response?.status ?? "no response"` inside template literals is already-typed because `yenpress.ts` uses the same pattern.

- [ ] **Step 4: If `pnpm test` flags a snapshot/diff, re-read the failure**

The only test touched by this plan is `sevenseas.test.ts`; any other test failure means Task 12 broke something downstream. Revisit Task 12's import-order fix.

- [ ] **Step 5: Commit lint/format fixups (if any) separately from feature commits**

If Prettier or ESLint rewrote files during this task, commit the cleanups on their own:

```bash
git add -u
git commit -m "[Chore] Fix lint/format in Seven Seas scraper"
```

Skip this commit if nothing was modified.

---

## Task 14: File Notion follow-up tasks

**Files:** none (external system)

Per `CLAUDE.md`, out-of-scope issues discovered during implementation should be filed on the Notion board at `https://www.notion.so/31df24d3107d80ac8669dcf7281c8537?v=31df24d3107d80ecadca000c731ad204` so they can be picked up without rediscovery.

The follow-ups the spec already lists:

1. **3-in-1+ omnibus handling**. Current `buildProductPath` assumes 2-in-1. Seven Seas also publishes 3-in-1 omnibuses (e.g., certain older reprints) which use `/books/<slug>-omnibus-vol-1-3/` or similar. Where to look: `plugins/manga-enricher/src/publishers/sevenseas.ts::buildProductPath`. Possible approach: try 2-in-1 first, then fall back to 3-in-1 on 404; or probe the series page to enumerate.

2. **Match Seven Seas imprints when MU lists them as separate publishers**. MangaUpdates sometimes lists "Airship", "Ghost Ship", "Steamship", "Danmei", "Siren", "Waves of Color" as standalone English publishers. `sevenseasScraper.matchPublisher` only accepts strings containing "Seven Seas". Where to look: `plugins/manga-enricher/src/publishers/sevenseas.ts::matchPublisher`. Possible approach: extend the regex to `/\b(seven\s+seas|airship|ghost\s+ship|steamship|danmei|siren|waves of color)\b/i`. Risk: imprint names are short and generic and may collide with unrelated series ("Airship" in a sci-fi manga title, etc.) — gate on the exact publisher-string match, not a substring that could appear in a series name.

3. **Live-site 403 on non-browser User-Agents**. `curl -A Mozilla/...` against `sevenseasentertainment.com` returns HTTP 403. Fixtures for this plan were saved from `web.archive.org` snapshots as a workaround. Unknown whether the goja-runtime `shisho.http.fetch` has different networking behavior that avoids the block. Where to look: `plugins/manga-enricher/src/publishers/sevenseas.ts::fetchHtml`. Possible approach: test end-to-end against the real site once Shisho is running locally; if blocked, switch the `User-Agent` to a real Chrome UA string as a first mitigation.

4. **Series-page fallback for mismatched slugs**. When the user's filename slugifies differently from Seven Seas' URL slug (e.g. "2.5 Dimensional Seduction" is fine but an exotic title may not match exactly), the scraper fails cleanly. Where to look: `plugins/manga-enricher/src/publishers/sevenseas.ts::searchVolume`. Possible approach: on 404, fetch `/series/<slug>/` and scan for `/books/.../vol-<N>/` links, similar to `yenpress.ts::pickProductPath`.

- [ ] **Step 1: Create one Notion task per follow-up**

For each of the four follow-ups above, create a Notion task on the Shisho board containing:
- **Title**: short description (e.g., "manga-enricher: Seven Seas 3-in-1 omnibus support")
- **Body**: the full context from the spec and plan (what/where/why/how), including the file path and function name. Paste the relevant paragraph from above verbatim.

Use `mcp__claude_ai_Notion__notion-create-pages` targeting the Shisho board database.

- [ ] **Step 2: Verify creation**

Run `mcp__claude_ai_Notion__notion-search` with a title keyword to confirm each task is visible on the board.

---

## Acceptance checklist

After all tasks complete, the following must be true:

- `pnpm --filter manga-enricher test -- --run sevenseas.test.ts` passes with ~40 test cases.
- `pnpm check` passes at the repo root.
- `git log --oneline | head -14` shows one commit per task (14 commits max, or fewer if lint/format fixups weren't needed).
- `plugins/manga-enricher/src/publishers/sevenseas.ts` exists and exports `sevenseasScraper`.
- `plugins/manga-enricher/src/lookup.ts` imports and registers it.
- All four follow-ups from Task 14 exist on the Notion board.
