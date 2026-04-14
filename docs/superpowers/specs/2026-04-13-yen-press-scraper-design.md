# Yen Press publisher scraper

Add a Yen Press scraper to the `manga-enricher` plugin so volumes published by Yen Press get per-volume metadata (ISBN, release date, imprint, description, cover) the same way Viz and Kodansha volumes already do.

## Context

`manga-enricher` pulls series-level data from MangaUpdates and, when MU lists a recognized English publisher, calls a publisher scraper for per-volume fields. Today the registry in `src/lookup.ts` contains `vizScraper` and `kodanshaScraper`. Yen Press is a major English publisher (Fruits Basket Collector's Edition, Spy×Family, Teasing Master Takagi-san, etc.) currently unsupported.

Each scraper is a module under `src/publishers/` implementing `PublisherScraper` (`name`, `matchPublisher`, `searchVolume`). This design adds `src/publishers/yenpress.ts`, registers it in `lookup.ts`, updates `manifest.json`, and adds tests plus HTML fixtures.

## Investigation summary

Reference pages:
- `https://yenpress.com/titles/9781975353308-teasing-master-takagi-san-vol-1` (regular volume)
- `https://yenpress.com/titles/9780316360166-fruits-basket-collector-s-edition-vol-1` (edition variant)

Key observations:

1. **No JSON-LD.** Structured data lives in DOM-level detail boxes.
2. **Product URL contains the ISBN** (`/titles/<ISBN>-<slug>-vol-<N>`), so we cannot build the product URL from (series, volume) alone.
3. **Series page lists every volume.** `https://yenpress.com/series/<slug>` returns an HTML page with `<a href="/titles/<ISBN>-<slug>-vol-<N>">` links for every volume in the series, matchable by the trailing `vol-<N>` token.
4. **Slug rule:** lowercase, then replace runs of non-alphanumeric with a single hyphen, trim leading/trailing hyphens. Apostrophes are *not* dropped first — they become hyphens along with spaces. Verified on both reference pages:
   - "Teasing Master Takagi-san" → `teasing-master-takagi-san`
   - "Fruits Basket Collector's Edition" → `fruits-basket-collector-s-edition`
   This differs from `kodansha.ts::slugify`, which strips apostrophes before hyphenation.
5. **Detail boxes.** Fields are rendered as:
   ```html
   <div class="detail-box">
     <span class="type paragraph fs-15">ISBN</span>
     <p class="info">9781975353308</p>
   </div>
   ```
   Present labels: `Series`, `Trim Size`, `Page Count`, `ISBN`, `Release Date`, `Age Rating`, `Imprint`. We consume ISBN, Release Date, Imprint. (Page Count is file-parser-owned, same convention as Viz.)
6. **Two detail-info sections.** The product page has a "Print" `.detail-info` block followed by a "Digital" block with its own ISBN. Both reuse the same `.detail-box` structure.
7. **Description** lives in `<p class="paragraph fs-16">` inside `.content-heading-txt`, near the top of the page.
8. **Cover image** is hosted at `https://images.yenpress.com/imgs/<ISBN>.jpg?w=...&h=...&type=books&s=<hash>`. The same URL appears both in the `.series-cover .book-cover-img img[data-src]` attribute and again further down the page.
9. **Release date format** is `Jul 24, 2018` — short month name, day, year. Needs its own parser (Viz's format is `September 5, 2023`; close enough to reuse logic but not identical — short vs long month name).
10. **Imprint** value on the sample pages is `Yen Press`. The site's nav advertises other imprints (Yen On, JY, Yen Audio, Ize Press, J-Novel Club) so the field is genuinely variable.

## Design

### Module layout

```
plugins/manga-enricher/src/publishers/yenpress.ts   (new)
plugins/manga-enricher/src/__tests__/yenpress.test.ts   (new)
plugins/manga-enricher/src/__tests__/fixtures/
  yenpress-takagi-series.html       (new, trimmed /series/ page)
  yenpress-takagi-vol1-product.html (new, trimmed product page)
```

`lookup.ts` adds `yenpressScraper` to the `SCRAPERS` registry after `kodanshaScraper`. `manifest.json` adds `yenpress.com` and `images.yenpress.com` to `httpAccess.domains`, and extends the description string to mention Yen Press.

### Scraper behavior

`yenpressScraper.searchVolume(seriesTitle, volumeNumber, edition)`:

1. Build slug with Yen Press–specific `slugify()` (local to the module, distinct from Kodansha's). If `edition` is provided, append it to `seriesTitle` before slugifying (mirrors Viz's edition handling). If slug is empty, return `null`.
2. Fetch `https://yenpress.com/series/<slug>`. On error or non-2xx, return `null`.
3. Scan the response HTML with a regex `href="(/titles/[^"]*?-vol-(\d+))"` to collect `(path, volumeNumber)` pairs. Pick the path whose captured number equals the requested `volumeNumber`. If none match, return `null`.
4. Fetch `https://yenpress.com<path>`. On error, return `null`.
5. Parse with `shisho.html.parse` and return a `VolumeMetadata` object from the extracted fields.

Must never throw — all failure paths return `null`, matching `PublisherScraper`'s contract.

### Parsing the product page

A single exported `parseProduct(html, url): VolumeMetadata | null` does the work; the default export is the scraper object that wires `parseProduct` to the HTTP layer. Keeping `parseProduct` pure mirrors Viz/Kodansha and makes fixture-based testing straightforward.

Helpers inside `yenpress.ts`:

- **`extractDetailBox(doc, label)`** — iterates `.detail-box` elements, returns the `.info` text whose sibling `span.type` text equals `label` (case-insensitive). Used for ISBN, Release Date, Imprint.
- **`parseYenPressDate(text)`** — converts `Jul 24, 2018` to `2018-07-24T00:00:00Z`. Accepts both long and short month names via a shared month-name map so long-form dates also parse.
- **`pickIsbn(doc)`** — prefers the ISBN inside a detail-info block labelled/containing "Digital" (matching Kodansha's ebook preference). Falls back to the first `.detail-box` labelled "ISBN" on the page. Returns `{ isbn13?, isbn10? }`.
- **`extractDescription(doc)`** — reads `.content-heading-txt p.paragraph.fs-16` and returns its trimmed text, or `undefined`.
- **`extractCover(doc, isbn13)`** — prefers the first `.book-cover-img img` attribute (`data-src` or `src`), falling back to `https://images.yenpress.com/imgs/<isbn13>.jpg` if we have an ISBN but no DOM hit.

Returned fields:

| VolumeMetadata field | Source |
| --- | --- |
| `url` | passed in from `searchVolume` |
| `description` | `.content-heading-txt p.paragraph.fs-16`, stripped with `stripHTML` |
| `releaseDate` | detail box "Release Date", parsed via `parseYenPressDate` |
| `imprint` | detail box "Imprint" |
| `isbn13` / `isbn10` | see `pickIsbn` |
| `coverUrl` | see `extractCover` |
| `subtitle` | not populated — Yen Press product pages don't have a stable per-volume subtitle field |

### Picking the digital ISBN

Kodansha prefers `bookFormat: EBook` inside JSON-LD `workExample`. Yen Press's equivalent is positional: the product page renders a "Main" (print) `.detail-info` block followed by a "Digital" one. The only textual marker separating them in the fetched sample is an HTML comment (`<!-- Main -->` / `<!-- Digital -->`), which `shisho.html` does not expose, so we use index.

Rule:

1. `shisho.html.querySelectorAll(doc, "div.detail-info")` in document order.
2. If there are 2+ blocks, read the ISBN out of the second block (digital). If that block has no ISBN detail box, fall through to the first block.
3. If there's only one block, read from it.
4. If no blocks at all, return `{}`.

Return `{ isbn13?, isbn10? }` normalized (hyphens stripped; 13 vs 10 chosen by length).

### Matching the publisher

`matchPublisher(publisherName)` uses `/\byen\s*press\b/i`. This matches MangaUpdates' "Yen Press" entries without claiming other Yen imprints (Yen On, JY, Ize Press, J-Novel Club) that MU may list under their own names. Out of scope for this change; those can be added later if users report gaps.

### Edition handling

`searchVolume` receives an optional `edition` string parsed from the filename (e.g. `"Collector's Edition"`). It appends it to the series title before slugifying, so `"Fruits Basket" + "Collector's Edition"` produces `fruits-basket-collector-s-edition`, matching the reference URL. No other edition logic is needed at this layer — `lookup.ts` already bubbles edition-matching publishers to the front of its publisher list.

### Error handling

Mirrors Viz/Kodansha exactly:
- All HTTP failures (no response, non-ok status) log a `shisho.log.warn` and return `null` from `fetchHtml`.
- Parse failures (no matching volume link, missing ISBN block, unparseable date) return `null` or omit the specific field, never throw.
- `searchVolume` always returns `null` on any failure path; never propagates exceptions.

### Registry integration

```ts
// lookup.ts
import { yenpressScraper } from "./publishers/yenpress";

const SCRAPERS: readonly PublisherScraper[] = [
  vizScraper,
  kodanshaScraper,
  yenpressScraper,
];
```

Registration order is incidental — `lookup.ts::findVolumeData` iterates the MU-supplied publisher list and picks the scraper that matches each, so a MU series listing "Yen Press" will select `yenpressScraper` regardless of registry order.

### Manifest updates

Add to `manifest.json`:
- `httpAccess.domains`: `yenpress.com`, `images.yenpress.com`
- `capabilities.metadataEnricher.description`: append "and Yen Press"
- `capabilities.httpAccess.description`: append "and Yen Press"

`manifest.json` version stays at `0.1.0` for the design; release is handled via the normal `pnpm release` flow after merge.

## Testing

Follow the existing pattern in `__tests__/viz.test.ts` and `__tests__/kodansha.test.ts`:

- **Fixtures.** Trim the fetched series and product pages down to the sections we parse (detail boxes, description block, cover img, plus a few surrounding lines for structural anchors). Check them into `src/__tests__/fixtures/`.
- **Pure-parse tests** (no HTTP mocking):
  - `parseProduct` returns ISBN-13, release date as ISO, imprint `"Yen Press"`, description starting with the expected first words, cover URL on `images.yenpress.com`.
  - Digital ISBN preference: feed a fixture that has both print and digital blocks; assert we return the digital ISBN.
  - Date parser: `"Jul 24, 2018"` → `"2018-07-24T00:00:00Z"`; unparseable input → `undefined`.
  - Slugify: `"Teasing Master Takagi-san"` → `teasing-master-takagi-san`; `"Fruits Basket Collector's Edition"` → `fruits-basket-collector-s-edition`; leading/trailing punctuation trimmed.
  - `pickProductPath`-equivalent: feed the series fixture, ask for vol 1, assert we pick the correct `/titles/...` path; ask for a volume that doesn't exist, assert `null`.
- **`searchVolume` happy path** via `vi.stubGlobal` on `shisho.http.fetch` — same technique Kodansha tests already use — asserting the sequence of URLs requested (series page first, product page second) and the merged `VolumeMetadata` result.
- **`matchPublisher`** sanity: `"Yen Press"` → true, `"Viz Media"` → false, `"Yen On"` → false (documents the intentional narrow match).

No changes to `lookup.test.ts` unless a registry-level integration test already there wants to cover Yen Press; the current suite tests the publisher-matching path generically and does not need a per-publisher fixture.

## Out of scope

- Yen On, JY, Ize Press, J-Novel Club (separate MU publisher names — can reuse most of this module later by widening `matchPublisher` and verifying the page structure is the same).
- Light novel CBZ support (manga-enricher targets `cbz`/`cbr` only; light novels are typically EPUB).
- Yen Press search API reverse-engineering (the `/search/*` page is JS-rendered; `/series/<slug>` is sufficient).
- Page Count / Trim Size extraction (file-parser-owned, per existing convention).
