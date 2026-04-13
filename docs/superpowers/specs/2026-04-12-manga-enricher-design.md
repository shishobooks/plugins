# Manga Enricher Plugin — Design

## Overview

`manga-enricher` is a Shisho metadata enricher plugin for manga CBZ/CBR files. It combines MangaUpdates (for series-level metadata) with publisher website scraping (for per-volume details) to provide rich metadata at the per-volume level.

The key insight driving this design: no single manga metadata source provides complete per-volume data. MangaUpdates has the strongest series identification and publisher data, but only tracks per-volume release dates (not synopses). Publisher product pages are the canonical source for per-volume synopses but require different handling per site. We combine them.

This is intended as Shisho's official manga plugin, so it must work with the general case — including messy filenames — not just well-organized collections.

## Goals

- Identify a manga series and specific volume from a filename
- Pull rich series-level metadata (authors, genres, tags, description, publisher, status)
- Pull per-volume metadata (synopsis, release date, ISBN, page count) from supported publishers
- Degrade gracefully when a publisher isn't supported or a volume can't be matched
- Make it easy to add new publishers (and eventually other languages) over time

## Non-Goals

- Cover art — CBZ files have covers built into the comic pages; we don't need to fetch them
- Non-English publishers in v1 — the architecture supports them, but Viz + Kodansha ship first
- Audiobook or light novel metadata — out of scope; existing enrichers handle books/audiobooks
- Chapter-level metadata — we operate at the volume level only

## Plugin Identity

- **Plugin ID:** `manga-enricher`
- **File types:** `cbz`, `cbr`
- **Config schema:** none (empty) — MangaUpdates API is free and keyless; publisher scrapers need no auth

### Identifier Types

- `mangaupdates_series` — links to `https://www.mangaupdates.com/series/{value}`

### HTTP Access Domains

- `api.mangaupdates.com`
- `www.viz.com`
- `kodansha.us`

## Architecture

The plugin follows the pattern established by existing enrichers (`open-library-enricher`, `goodreads-enricher`, `audible-enricher`):

```
plugins/manga-enricher/
  manifest.json
  package.json
  CHANGELOG.md
  src/
    index.ts              # Entry point — exports ShishoPlugin with metadataEnricher.search()
    lookup.ts             # Tiered lookup chain: ID → title search → publisher scraping
    filename.ts           # Filename parser: extract series title, volume number, edition
    mangaupdates/
      api.ts              # MangaUpdates API client (search, fetch series)
      types.ts            # MU response types
      mapping.ts          # MU response → series-level ParsedMetadata
    publishers/
      types.ts            # Shared VolumeMetadata interface for all publisher scrapers
      viz.ts              # Viz Media scraper
      kodansha.ts         # Kodansha USA scraper
    __tests__/
      filename.test.ts
      lookup.test.ts
      mangaupdates.test.ts
      viz.test.ts
      kodansha.test.ts
```

The `publishers/` directory is the extension point: each scraper is a self-contained module implementing a shared interface. Adding a new publisher means adding one file and registering it in `lookup.ts`.

## Query Parsing (`src/filename.ts`)

The plugin receives a `SearchContext` with a `query` string from Shisho. For CBZ/CBR files, Shisho's scan pipeline populates this query from file metadata — which for comics often means something derived from the filename, since CBZ files frequently lack embedded metadata. We don't know exactly how clean or messy that query will be, so the parser is defensive: it handles both already-cleaned titles and raw filename-like strings gracefully.

The parser extracts three things from `context.query`: **series title**, **volume number**, and **edition variant** (if any). It never looks at a file path — only the query string.

### Parsing Steps

1. Remove a file extension suffix if present (`.cbz`, `.cbr`) — defensive in case the query includes it.
2. Strip parenthesized groups from the right: `(2018)`, `(Digital)`, `(danke-Empire)`, etc. These are year/format/scan group tags. We discard them.
3. Detect edition variants by matching against a known list (case-insensitive) before the volume marker. If one is found, split it out and remove it from the series title.
4. Extract the volume number via regex patterns, in this order:
   1. `v(\d+)` — matches `v01`, `v1`
   2. `[Vv]ol(?:ume)?\.?\s*(\d+)` — matches `Vol. 03`, `Volume 001`
   3. `#(\d+)` — matches `#001`
   4. `\s(\d{2,3})$` — trailing 2-3 digit number as last resort (restricted to avoid matching years)
5. The remaining string (after cleanup of trailing whitespace, hyphens, and dashes) is the series title.

The full cleaned title — including any dash-separated subtitles like `Demon Slayer - Kimetsu no Yaiba` — is passed to MangaUpdates search as-is. MangaUpdates matches against associated titles in many languages, so no language detection is needed. If the full title yields no good match, we retry with just the part before the first ` - ` as a fallback.

### Known Edition Variants

A hardcoded list of edition keywords. The list is finite and publisher-standard; additions are trivial:

```
Collector's Edition
Omnibus Edition
Omnibus
Box Set
Deluxe Edition
Deluxe
3-in-1 Edition
2-in-1 Edition
Master Edition
Perfect Edition
Complete Edition
Fullmetal Edition
Digital Colored Comics
Full Color Edition
```

### Parsing Examples

| Filename | Series Title | Volume | Edition |
|----------|-------------|--------|---------|
| `Bakuman #001 (2010).cbz` | Bakuman | 1 | — |
| `20th Century Boys - Volume 001.cbr` | 20th Century Boys | 1 | — |
| `365 Days to the Wedding v01 (2023) (Digital) (1r0n).cbz` | 365 Days to the Wedding | 1 | — |
| `Demon Slayer - Kimetsu no Yaiba v01 (2018) (Digital) (danke-Empire).cbz` | Demon Slayer - Kimetsu no Yaiba | 1 | — |
| `Fruits Basket Collector's Edition v01 (2016) (Digital) (LuCaZ).cbz` | Fruits Basket | 1 | Collector's Edition |
| `Bleach - Digital Colored Comics v01 (2021) (KojoZero Scans).cbz` | Bleach | 1 | Digital Colored Comics |

## Lookup Flow (`src/lookup.ts`)

A tiered lookup chain, mirroring the existing enrichers:

### Tier 1: MangaUpdates ID Lookup (confidence 1.0)

If the search context already contains a `mangaupdates_series` identifier, fetch the series directly by ID and proceed to metadata mapping + publisher scraping.

### Tier 2: Title Search (variable confidence)

1. Parse `context.query` using `filename.ts` to extract series title, volume number, and edition variant.
2. Search MangaUpdates via `POST /v1/series/search` with the parsed title.
3. For each result, compare the query against the result's primary title and all associated titles using Levenshtein distance (same shared utility as other enrichers: `levenshteinDistance`, `normalizeForComparison`).
4. Accept matches where `distance ≤ 5` and `ratio ≤ 0.4`. Confidence is `1 - ratio`.
5. If no good match on the full title and it contains ` - `, retry with just the part before the dash.
6. Still return results even if the English publisher isn't one we support — we just skip per-volume scraping and return series-level data only.

### After Series Identification

1. Map the MangaUpdates response to a series-level `ParsedMetadata` (authors, artists, genres, tags, description, status, publisher).
2. Check the English publisher. If it's Viz or Kodansha, call that publisher's scraper with `(seriesTitle, volumeNumber, edition?)`.
3. Merge per-volume scraper fields into the metadata (synopsis, release date, ISBNs, page count, imprint, age rating, URL).
4. If the scraper fails or returns nothing, fall back gracefully to series-level metadata only.

### Fallback: Try Multiple Publishers (Optional)

If the MangaUpdates publisher field doesn't match a supported publisher (or is missing), try each supported publisher's `searchVolume` in sequence and use the first one that finds a match. This is the "B fallback" to the primary publisher-routing path.

## MangaUpdates Integration (`src/mangaupdates/`)

### API Client (`api.ts`)

- `searchSeries(query: string): SearchResult[]` — `POST https://api.mangaupdates.com/v1/series/search` with JSON body `{ "search": query }`
- `fetchSeries(id: string): Series` — `GET https://api.mangaupdates.com/v1/series/{id}`

Uses `shisho.http.fetch()`. Includes a descriptive `User-Agent` header (`ShishoPlugin/manga-enricher/x.y.z`).

### Response Mapping (`mapping.ts`)

| Shisho field | MangaUpdates field | Notes |
|---|---|---|
| `title` | `title` | Primary English or romanized title |
| `series` | `title` | Same as title at series level |
| `authors` | `authors[]` + `artists[]` | Map author → role `writer`, artist → role `penciller`. If same person in both, include as both roles. |
| `genres` | `genres[]` | Direct copy |
| `tags` | `categories[]` | Community-voted categories, more granular than genres |
| `description` | `description` | Strip HTML using shared `stripHTML` utility |
| `publisher` | `publishers[].publisher_name` where type is "English" | First English publisher |
| `url` | `url` | MangaUpdates series URL |
| `identifiers` | `series_id` | As `mangaupdates_series` |
| `language` | — | Hardcoded `"en"` in v1 |

## Publisher Scraping (`src/publishers/`)

### Shared Interface (`types.ts`)

```typescript
export type VolumeMetadata = {
  title?: string;
  subtitle?: string;
  description?: string;
  releaseDate?: string;      // ISO 8601
  isbn13?: string;
  isbn10?: string;
  pageCount?: number;
  imprint?: string;
  ageRating?: string;
  url?: string;
};

export interface PublisherScraper {
  readonly name: string;     // e.g. "Viz Media"
  readonly matchPublisher: (publisherName: string) => boolean;
  searchVolume(
    seriesTitle: string,
    volumeNumber: number,
    edition?: string,
  ): VolumeMetadata | null;
}
```

Each publisher scraper implements this interface as a self-contained module. `lookup.ts` maintains a registry of scrapers and routes based on the MangaUpdates publisher field (or tries all as a fallback).

### Viz Media Scraper (`viz.ts`)

**Domain:** `www.viz.com`

**Search URL:** `https://www.viz.com/search?search={query}&category=Manga`

**Volume URL pattern:** `https://www.viz.com/manga-books/manga/{title-slug}/product/{numeric-id}`

**Flow:**
1. Hit the search URL with the series title (plus edition variant appended if present).
2. Parse the search results HTML to find the product link for the specific volume. Match by volume number and edition keywords in the product name.
3. Fetch the product page and extract metadata from:
   - HTML meta tags and page structure
   - JavaScript variables (`volumeNumber`, `mangaSeriesCommonId`, `mangaCommonId`)
   - Standard HTML elements for title, description, ISBN, release date, page count, age rating, imprint (e.g., "Shonen Jump"), categories

**Handling edition variants:** Editions like "Omnibus Edition" exist as separate series on Viz (e.g., "One Piece Omnibus Edition" distinct from "One Piece"). The scraper appends the edition to the search query when present.

### Kodansha USA Scraper (`kodansha.ts`)

**Domain:** `kodansha.us`

**Volume URL pattern:** `https://kodansha.us/series/{series-slug}/volume-{N}/`

**Flow:**
1. Slugify the series title (lowercase, hyphens, strip punctuation) and try the direct URL pattern first.
2. If that 404s, fall back to the browse page: `https://kodansha.us/browse/?q={query}` to find the correct series slug.
3. Fetch the volume page and parse the JSON-LD structured data (`Book` schema with `workExample` array) — much cleaner than raw HTML scraping.
4. Extract: title, description, ISBNs, release dates, page count, age rating.

**ISBN preference:** When multiple ISBNs are present (ebook + paperback), **prefer the ebook ISBN**.

### Adding New Publishers

A new publisher is a new file in `src/publishers/` implementing `PublisherScraper`, plus registration in `lookup.ts`. No other changes required. Supporting a new language = adding publishers for that language.

## Metadata Mapping Summary

| Shisho field | Source | Notes |
|---|---|---|
| `title` | Publisher page, fallback filename parser | Volume-specific (e.g., "One Piece, Vol. 1") |
| `subtitle` | Publisher page | Volume subtitle if present |
| `authors` | MangaUpdates | With roles: `writer` (author), `penciller` (artist) |
| `series` | MangaUpdates | Series name |
| `seriesNumber` | Filename parser | Volume number |
| `genres` | MangaUpdates | From `genres[]` |
| `tags` | MangaUpdates | From `categories[]` |
| `description` | Publisher page | Per-volume synopsis (the main prize) |
| `publisher` | Publisher page, fallback MangaUpdates | English publisher |
| `imprint` | Publisher page | e.g., "Shonen Jump" from Viz |
| `releaseDate` | Publisher page, fallback MangaUpdates release data | ISO 8601 |
| `language` | Hardcoded `"en"` | English in v1 |
| `identifiers` | Multiple | `mangaupdates_series`, `isbn_13` (ebook preferred), `isbn_10` |
| `url` | Publisher page | Volume product page |
| `confidence` | Lookup tier | 1.0 for ID match, Levenshtein-based for title match |

### Not Mapped

- `coverUrl` / `coverData` — CBZ files carry covers intrinsically
- `narrators` — not applicable
- `abridged` — not applicable

## Error Handling

- **MangaUpdates API failure:** return empty results (log warning via `shisho.log.warn`)
- **No MangaUpdates match:** return empty results
- **Publisher not supported:** return series-level metadata only, no per-volume fields
- **Publisher scraper failure (network, unexpected HTML):** log a warning, return series-level metadata only
- **Publisher scraper returns no match for the volume:** return series-level metadata only

The plugin never throws to the host — it always returns a `SearchResponse`, possibly empty.

## Testing

Tests use vitest, following the conventions in existing plugins:

- **`filename.test.ts`** — extensive coverage of filename parsing edge cases, using the real examples the user provided plus synthetic messy cases
- **`mangaupdates.test.ts`** — mocks the API module, tests mapping logic against fixture responses
- **`viz.test.ts`** / **`kodansha.test.ts`** — tests parsing against fixture HTML snippets captured from real product pages
- **`lookup.test.ts`** — mocks both MangaUpdates and publisher scrapers, tests the lookup flow end-to-end including fallback behavior

Mocks reset via `vi.restoreAllMocks()` in `beforeEach`. HTTP layer (`shisho.http.fetch`) is mocked globally via `test/setup.ts`, same as other plugins.

## Release

- Added to `repository.json` alongside existing plugins
- Follows the per-plugin release process: tag as `manga-enricher@<version>`, maintain its own `CHANGELOG.md`
- Initial version: `0.1.0`
