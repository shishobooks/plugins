# Seven Seas publisher scraper

Add a Seven Seas Entertainment scraper to the `manga-enricher` plugin so volumes published by Seven Seas get per-volume metadata (ISBN, release date, imprint, description, cover) the same way Viz, Kodansha, and Yen Press volumes already do.

## Context

`manga-enricher` pulls series-level data from MangaUpdates and, when MU lists a recognized English publisher, calls a publisher scraper for per-volume fields. Today the registry in `src/lookup.ts` contains `vizScraper`, `kodanshaScraper`, and `yenpressScraper`. Seven Seas is a major English manga/light-novel publisher (Monster Musume, Tokyo Revengers, Rozen Maiden, 365 Days to the Wedding, Hokkaido Gals Are Super Adorable, etc.) currently unsupported.

Each scraper is a module under `src/publishers/` implementing `PublisherScraper` (`name`, `matchPublisher`, `searchVolume`). This design adds `src/publishers/sevenseas.ts`, registers it in `lookup.ts`, and adds unit tests plus HTML fixtures.

## Investigation summary

Reference pages probed via web.archive.org (the live site blocks non-browser User-Agents with a 403):
- `https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/` — regular volume, new-style date
- `https://sevenseasentertainment.com/books/monster-musume-vol-1/` — regular volume, slash-format date (old template)
- `https://sevenseasentertainment.com/books/rozen-maiden-collectors-edition-vol-5/` — edition variant, apostrophe dropped, new template
- `https://sevenseasentertainment.com/books/2-5-dimensional-seduction-vol-1/` — Ghost Ship sub-imprint, new (`gomanga2025`) template
- `https://sevenseasentertainment.com/books/ladies-on-top-vol-1/` — Steamship sub-imprint
- `https://sevenseasentertainment.com/books/tokyo-revengers-omnibus-vol-1-2/` — 2-in-1 omnibus URL pattern

### Key observations

1. **Product URL is directly constructible.** Unlike Yen Press (ISBN embedded in URL), Seven Seas uses `/books/<slug>-vol-<N>/` with no unknown segments. Direct construction works, like Kodansha — no series-page probe needed.

2. **Two template generations coexist.** Older pages (`gomanga2017` / `gomanga2020` themes) wrap all meta fields in a single `<p>` joined by `</br>`:
   ```html
   <p><b>Story & Art by:</b> ... </br> <b>Release Date:</b> 2022/07/26</br> ... <b>ISBN:</b> 978-1-63858-571-8</p>
   ```
   Newer pages (`gomanga2025` theme) put each field in its own `<p>`:
   ```html
   <p><b>Release Date:</b> February 8, 2022</p>
   <p><b>ISBN:</b> 978-1-64827-881-5</p>
   ```
   Both share the same `<b>Label:</b> value` shape, so a single regex scan of the `#volume-meta` inner HTML — `/<b>\s*Label\s*:\s*<\/b>\s*([^<]+)/i` — handles both.

3. **Date format varies by era.** Two formats observed:
   - `November 14, 2023` (same shape as Yen Press)
   - `2022/07/26` (YYYY/MM/DD slash format, older titles)
   The scraper must parse both.

4. **Single ISBN per page.** Unlike Yen Press, Seven Seas product pages expose only one ISBN-13 (print). Both `978-` and `979-8-` prefixes appear. Strip hyphens, assign to `isbn13`. No `isbn10` handling, no ebook-variant preference.

5. **Slug rule:** lowercase, **drop apostrophes** (both `'` and `'`), then collapse runs of non-alphanumerics to single hyphens, trim leading/trailing hyphens. Apostrophe handling verified by `rozen-maiden-collectors-edition-vol-5` (not `rozen-maiden-collector-s-edition-vol-5`). Period handling verified by `2-5-dimensional-seduction-vol-1` (period becomes hyphen, collapses with adjacent hyphen). This matches `kodansha.ts::slugify` and differs from `yenpress.ts::buildSlug` (which keeps apostrophes as hyphens).

6. **Sub-imprint label.** Sub-imprints (Ghost Ship, Steamship, Airship, Danmei, Siren, Waves of Color) are rendered as a sibling of the main age-rating div, with an `id` matching `[A-Z]{2}-block`:
   ```html
   <div id="GS-block" class="age-rating"><a href="...ghostshipmanga.com/">Ghost Ship</a></div>
   <div id="SS-block" class="age-rating">Steamship</div>
   ```
   Pages with no sub-imprint (main Seven Seas line) have no such element — only `<div class="age-rating" id="olderteen15"></div>` (the rating badge). Extraction rule: find `div.age-rating` whose `id` attribute ends in `-block` (regex on the id attribute), take `.text.trim()`. Absent = omit the `imprint` field.

7. **Description.** Inside `#volume-meta`, the product description sits between a horizontal-dot separator paragraph (`<p style="text-align: center;">▪ ▪ ▪ ...</p>`) and the `<div id="single-book-retailers">` block. Consistent across both template generations. Collect the `<p>` children in document order, drop `<p class="bookcrew">` (translation credits), skip empty paragraphs, join with `\n\n`, run through `stripHTML`.

8. **Cover image.** `<div id="volume-cover"><img src="..."></div>`. `src` is an absolute Seven Seas CDN URL in both template generations — no lazy-load shenanigans.

9. **Omnibus pattern.** All four omnibus samples follow `<slug>-omnibus-vol-<start>-<end>/` where `end = start + 1` (strictly 2-in-1). The URL's volume range mirrors the Japanese volumes bundled, not the omnibus sequence number — so "Tokyo Revengers Omnibus Vol 1" in a filename (meaning the first omnibus, containing JP vols 1-2) maps to `/books/tokyo-revengers-omnibus-vol-1-2/`.

## Architecture

New file: `plugins/manga-enricher/src/publishers/sevenseas.ts`, implementing `PublisherScraper`. Follows the same module layout as `yenpress.ts` and `kodansha.ts`.

### URL construction

```
BASE = https://sevenseasentertainment.com

baseSlug = slugify(seriesTitle + (edition && !isOmnibus(edition) ? " " + edition : ""))

if edition matches /omnibus/i:
    path = /books/<baseSlug>-omnibus-vol-<2N-1>-<2N>/
else:
    path = /books/<baseSlug>-vol-<N>/
```

The edition is only folded into the slug when it's **not** an omnibus — for omnibuses the "-omnibus-vol-" segment is injected directly. For other editions (Collector's Edition, Deluxe, etc.), the edition is appended to the series title before slugifying, matching Yen Press's approach.

Edition-to-slug example: `"Rozen Maiden"` + `"Collector's Edition"` → slugify(`"Rozen Maiden Collector's Edition"`) → `rozen-maiden-collectors-edition`.

Omnibus example: `seriesTitle="Tokyo Revengers"`, `volumeNumber=1`, `edition="Omnibus"` → `/books/tokyo-revengers-omnibus-vol-1-2/`.

### `slugify(title)`

```ts
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['\u2019]/g, "") // strip ASCII and Unicode right-single-quote
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

### `parseSevenSeasDate(raw)`

Returns ISO 8601 or `undefined`. Accepts:
- `"November 14, 2023"` / `"Nov 14, 2023"` — same month-name table as Yen Press.
- `"2022/07/26"` — YYYY/MM/DD numeric slashes.

Implementation: trim, collapse whitespace, try the month-name regex first, then the `^(\d{4})/(\d{1,2})/(\d{1,2})$` regex.

### `parseProduct(html, url)`

Returns `VolumeMetadata | null`. Always produces at least `{ url }`. Steps:

1. `doc = shisho.html.parse(html)`
2. `url` — from the caller
3. `coverUrl` — `div#volume-cover img` → `attributes.src`, keep if starts with `http`
4. `imprint` — walk `div.age-rating`, return `.text.trim()` of the first one whose `id` ends in `-block` (regex `/-block$/`)
5. `meta = querySelector('#volume-meta')` — bail fields 6–8 if missing
6. Get the inner HTML of `meta` (via `.text` won't work because we need to distinguish field labels; instead, iterate `meta.children` and use a labelled-scan helper)
7. `releaseDate` — scan `meta` for a `<b>` whose text is `"Release Date:"` (whitespace-flexible), take the following sibling text node up to the next tag; pass through `parseSevenSeasDate`
8. `isbn13` — same labelled-scan helper for `"ISBN:"`; strip hyphens; only keep if 13 digits
9. `description` — walk `meta.children`, find the `<p>` whose trimmed text starts with `▪` (U+25AA) or matches a run of bullet-ish chars, then collect all subsequent `<p>` children that are NOT `class="bookcrew"`. Join text with `\n\n`, run through `stripHTML`, trim.

Labelled-scan helper is a **regex on the raw HTML string**, scoped to the substring between `<div id="volume-meta"` and the first `<div id="single-book-retailers"` (or end-of-document). Walking the `shisho.html` DOM is awkward here because the value is a text node that's a following sibling of `<b>`, not a child — and the DOM wrapper varies between templates (`<p><b>…</b> text</p>` vs `<b>…</b> text</br>`). A string regex is simpler and survives both layouts:

```ts
function extractLabeledValue(metaHtml: string, label: string): string | undefined {
  const re = new RegExp(
    `<b>\\s*${label}\\s*:\\s*</b>\\s*([^<]+)`,
    "i",
  );
  const match = metaHtml.match(re);
  return match?.[1].replace(/\s+/g, " ").trim();
}
```

The raw `#volume-meta` slice is obtained by string-searching the original HTML for `<div id="volume-meta"` and `<div id="single-book-retailers"` markers rather than round-tripping through the DOM. The tree parser (`shisho.html.parse`) is still used for `div#volume-cover img` (cover) and the imprint `div.age-rating[id$=-block]` lookup, because those are clean selector queries.

### `searchVolume(seriesTitle, volumeNumber, edition?)`

```
1. slug = slugify(seriesTitle + (edition && !/omnibus/i.test(edition) ? " " + edition : ""))
2. if slug is empty → return null
3. if /omnibus/i.test(edition) → path = `/books/${slug}-omnibus-vol-${2N-1}-${2N}/`
   else                       → path = `/books/${slug}-vol-${N}/`
4. fetchHtml(BASE + path); return null on non-200
5. return parseProduct(html, BASE + path)
```

### `matchPublisher(name)`

`/\bseven\s+seas\b/i` — matches "Seven Seas" and "Seven Seas Entertainment". Imprint-only publisher names ("Airship", "Ghost Ship") are **not** matched in this MVP — see Follow-ups.

### Registry update

Append `sevenseasScraper` to `SCRAPERS` in `src/lookup.ts`, after `yenpressScraper`:

```ts
const SCRAPERS: readonly PublisherScraper[] = [
  vizScraper,
  kodanshaScraper,
  yenpressScraper,
  sevenseasScraper,
];
```

## Components

- `plugins/manga-enricher/src/publishers/sevenseas.ts` — scraper module
- `plugins/manga-enricher/src/publishers/types.ts` — unchanged
- `plugins/manga-enricher/src/lookup.ts` — registry entry appended
- `plugins/manga-enricher/src/__tests__/sevenseas.test.ts` — new test file
- `plugins/manga-enricher/src/__tests__/fixtures/sevenseas-365-days-vol1.html` — old template, named-month date, 979-8 ISBN, no imprint
- `plugins/manga-enricher/src/__tests__/fixtures/sevenseas-tokyo-revengers-omnibus-vol1-2.html` — old template, slash-format date, 978- ISBN, tests omnibus URL construction
- `plugins/manga-enricher/src/__tests__/fixtures/sevenseas-25dim-seduction-vol1.html` — new `gomanga2025` template, Ghost Ship sub-imprint label

## Testing plan

`sevenseas.test.ts` (vitest) mirroring `yenpress.test.ts`'s structure:

### `matchPublisher`
- matches `"Seven Seas"`, `"Seven Seas Entertainment"`
- case-insensitive (`"seven seas"`)
- tolerates extra whitespace (`"Seven  Seas"`)
- does NOT match `"Yen Press"`, `"Viz Media"`, `"Kodansha USA"`
- does NOT match bare imprint names `"Ghost Ship"`, `"Airship"` (documents the known limitation)

### `slugify`
- `"Monster Musume"` → `"monster-musume"`
- `"2.5 Dimensional Seduction"` → `"2-5-dimensional-seduction"`
- `"Rozen Maiden Collector's Edition"` → `"rozen-maiden-collectors-edition"` (apostrophe dropped)
- Unicode right-quote: `"Rozen Maiden Collector\u2019s Edition"` → same as above
- trims leading/trailing: `"---Foo---"` → `"foo"`

### `buildProductPath(seriesTitle, volumeNumber, edition?)`
Unit test the URL-construction helper directly:
- `("Monster Musume", 1)` → `"/books/monster-musume-vol-1/"`
- `("Rozen Maiden", 5, "Collector's Edition")` → `"/books/rozen-maiden-collectors-edition-vol-5/"`
- `("Tokyo Revengers", 1, "Omnibus")` → `"/books/tokyo-revengers-omnibus-vol-1-2/"`
- `("Tokyo Revengers", 3, "Omnibus")` → `"/books/tokyo-revengers-omnibus-vol-5-6/"`
- Case-insensitive omnibus detection: `edition="omnibus"` works the same way

### `parseSevenSeasDate`
- `"November 14, 2023"` → `"2023-11-14T00:00:00Z"`
- `"Nov 14, 2023"` → same
- `"2022/07/26"` → `"2022-07-26T00:00:00Z"`
- `"2013/10/15"` → `"2013-10-15T00:00:00Z"`
- Malformed input returns `undefined`: `"TBA"`, `""`, `"2022-07-26"` (dashes, not slashes)

### `parseProduct` against fixtures
For each fixture, assert the expected `VolumeMetadata` shape:

**365 Days vol 1** (old template, no imprint):
- `isbn13: "9798888432631"`
- `releaseDate: "2023-11-14T00:00:00Z"`
- `coverUrl` starts with `https://sevenseasentertainment.com/` or `https://web.archive.org/` (fixtures are saved from archive — an inline normalization in the test can accept both; or strip archive prefixes when saving the fixture)
- `description` starts with `A sweet "fake engagement" romance`
- `imprint` is `undefined`

**Tokyo Revengers Omnibus vol 1-2** (old template, slash date):
- `isbn13: "9781638585718"`
- `releaseDate: "2022-07-26T00:00:00Z"`
- `description` starts with `The critically acclaimed manga series`
- `imprint` is `undefined`

**2.5 Dimensional Seduction vol 1** (new template, Ghost Ship):
- `isbn13: "9781648278815"`
- `releaseDate: "2022-02-08T00:00:00Z"`
- `imprint: "Ghost Ship"` (text of the `#GS-block` div, via `<a>` child)
- `description` starts with `A hot-blooded romantic cosplay comedy`

### `searchVolume` integration
Mock `shisho.http.fetch` using `vi.fn()`:
- Happy path: mock returns the 365 Days fixture → full metadata
- Volume not found: mock returns `{ ok: false, status: 404 }` → `null`
- Omnibus path: `edition="Omnibus"` fetches `/books/tokyo-revengers-omnibus-vol-1-2/` — assert the fetch URL
- Verifies URL construction reaches `fetchHtml` with the expected path for each scenario

## Fixtures

Fixtures will be saved from the web.archive.org snapshots probed during investigation. Before committing, strip the archive prefix so hrefs and image srcs point at the original `sevenseasentertainment.com` domain (otherwise tests accidentally assert against archive URLs). A one-line `sed` pipe during the save covers this:

```
curl -sSL ...archive.org/.../URL | \
  sed -E 's|https?://web\.archive\.org/web/[0-9]+(im_)?/||g' > fixture.html
```

## Error handling

Every failure path returns `null` from `searchVolume` (contract from `PublisherScraper.searchVolume`). `parseProduct` always returns at least `{ url }`. Missing fields are omitted, never defaulted. HTTP errors, unparseable HTML, missing `#volume-meta` — all handled by returning `null` or an incomplete record, never throwing.

## Out of scope / follow-ups

The following are deliberately excluded from this MVP and will be filed as follow-up tasks after implementation:

1. **Omnibus range formats other than 2-in-1.** Three-volume omnibuses (`-omnibus-vol-1-3/`) and other patterns exist but were not sampled; the current code only tries 2-in-1.
2. **Imprint-only publisher names.** MangaUpdates may list Seven Seas sub-imprints (Airship, Ghost Ship, Steamship, Danmei, Waves of Color, Siren) as separate publishers. `matchPublisher` only accepts strings containing "Seven Seas" — titles listed exclusively under an imprint name won't reach this scraper.
3. **Live-site 403 on non-browser User-Agents.** The live site returns 403 to `curl -A Mozilla/...`. The existing scrapers use a `ShishoPlugin/...` UA. If production scraping hits the same 403 we'll need to revisit UA spoofing; this MVP assumes `shisho.http.fetch` gets through (the goja runtime may have different networking behavior).
4. **Series-page fallback for mismatched slugs.** If the user's title slugifies differently from Seven Seas' URL slug, the scraper fails cleanly. A fallback that fetches `/series/<slug>/` and scans for `/books/.../vol-<N>/` links could recover some of these.

## Open questions

None blocking. The User-Agent 403 (item 3 above) is worth verifying once we can test against `shisho.http.fetch` in the dev docker container, but it does not block implementation — the scraper code is the same either way.
