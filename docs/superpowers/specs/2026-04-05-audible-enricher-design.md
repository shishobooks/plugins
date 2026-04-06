# Audible Metadata Enricher Plugin Design

## Overview

A metadata enricher plugin for Shisho that fetches audiobook metadata from Audible's catalog API, supplemented by Audnexus for genre/tag data. Targets M4B files only.

## Data Sources

### Audible Catalog API (primary)

Unauthenticated JSON API at `api.audible.{tld}/1.0/catalog/products`. Supports search by keywords, title, author, and direct ASIN lookup. Returns title, subtitle, authors, narrators, description, publisher, release date, series, cover images, duration, language, format type, ISBN, and category ladders.

Used by multiple open-source projects (audnexus, Audiobookshelf, mkb79/Audible) for years with no authentication required for catalog endpoints.

### Audnexus (supplementary)

Open-source metadata aggregator at `api.audnex.us`. Caches Audible data and supplements it with genre/tag information scraped from Audible HTML pages. Provides a clean REST API for ASIN-based lookup only (no search).

Used as an optimization for ASIN lookups (single call gets everything including genres) and as a genre enrichment layer for search results. Gracefully degrades — if Audnexus is unavailable, the plugin falls back to the Audible API without genres.

## Plugin Structure

```
plugins/audible-enricher/
  manifest.json
  package.json
  tsconfig.json
  logo.svg
  src/
    index.ts      -- Plugin export, metadataEnricher.search() hook
    api.ts        -- HTTP calls to Audible API and Audnexus
    lookup.ts     -- 3-tier search strategy with marketplace iteration
    mapping.ts    -- Transform API responses to ParsedMetadata
    types.ts      -- TypeScript types for Audible + Audnexus responses
    __tests__/
      api.test.ts
      lookup.test.ts
      mapping.test.ts
```

## Configuration

Single config field parsed at runtime:

```json
{
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

Marketplace code to API domain mapping:

| Code | API Domain |
|------|-----------|
| us | api.audible.com |
| uk | api.audible.co.uk |
| de | api.audible.de |
| fr | api.audible.fr |
| it | api.audible.it |
| es | api.audible.es |
| ca | api.audible.ca |
| au | api.audible.com.au |
| in | api.audible.in |
| jp | api.audible.co.jp |
| br | api.audible.com.br |

At runtime: `shisho.config.get("marketplaces")` returns a string like `"us,uk"`. Split on commas, trim whitespace, validate each code, ignore invalid ones. Default to `["us"]` if empty or missing.

## Manifest Capabilities

```json
{
  "metadataEnricher": {
    "description": "Fetches audiobook metadata from Audible catalog API and Audnexus",
    "fileTypes": ["m4b"],
    "fields": [
      "title", "subtitle", "authors", "narrators", "description",
      "publisher", "releaseDate", "series", "seriesNumber",
      "genres", "tags", "cover", "identifiers", "url"
    ]
  },
  "httpAccess": {
    "description": "Calls Audible catalog API, Audnexus API, and fetches cover images from Amazon CDN",
    "domains": [
      "api.audible.com", "api.audible.co.uk", "api.audible.de",
      "api.audible.fr", "api.audible.it", "api.audible.es",
      "api.audible.ca", "api.audible.com.au", "api.audible.in",
      "api.audible.co.jp", "api.audible.com.br",
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
}
```

## Lookup Strategy

### Tier 1: ASIN Lookup

When `context.identifiers` contains an ASIN:

1. Try Audnexus: `GET api.audnex.us/books/{ASIN}?region={primaryMarketplace}`
   - On success: map full response (including genres) to ParsedMetadata, confidence=1.0
   - On failure: fall through to step 2
2. Fallback to Audible API: `GET api.audible.{tld}/1.0/catalog/products/{ASIN}?response_groups=contributors,product_attrs,product_desc,product_extended_attrs,series,media,rating,category_ladders&image_sizes=500,1024`
   - Map to ParsedMetadata with genres from category_ladders, confidence=1.0

### Tier 2: Title + Author Search

When no ASIN is available:

1. For each configured marketplace (in order):
   - `GET api.audible.{tld}/1.0/catalog/products?keywords={query}&num_results=25&response_groups=contributors,product_attrs,product_desc,product_extended_attrs,series,media,rating&image_sizes=500,1024`
   - If `context.author` is available, include `&author={author}` parameter
2. Deduplicate results by ASIN — keep the first occurrence (from the highest-priority marketplace)
3. Levenshtein distance filter (same thresholds as existing plugins: max distance 5, max ratio 0.4)
4. Calculate confidence scores: `1 - (distance / maxLen)`
5. For each surviving result: try Audnexus `GET api.audnex.us/books/{ASIN}?region={marketplace}` for genres/tags (best-effort, skip on failure)
6. Merge genres/tags into ParsedMetadata

## API Details

### Audible Catalog API

**Search endpoint:**
```
GET api.audible.{tld}/1.0/catalog/products
  ?keywords={query}
  &author={author}           (optional)
  &num_results=25
  &products_sort_by=Relevance
  &response_groups=contributors,product_attrs,product_desc,product_extended_attrs,series,media,rating
  &image_sizes=500,1024
```

**Single product endpoint:**
```
GET api.audible.{tld}/1.0/catalog/products/{ASIN}
  ?response_groups=contributors,product_attrs,product_desc,product_extended_attrs,series,media,rating,category_ladders
  &image_sizes=500,1024
```

Headers: `User-Agent: ShishoPlugin/0.1.0 (audible-enricher)`, `Accept: application/json`

### Audnexus API

**Book lookup:**
```
GET api.audnex.us/books/{ASIN}?region={marketplace_code}
```

Returns JSON with: title, subtitle, authors, narrators, description, publisher, releaseDate, series (name + position), genres (array of {asin, name, type}), cover image URL, language, runtime in minutes.

### Rate Limiting

Audible API returns HTTP 429 with `Retry-After` header. No retry logic in the plugin — we log a warning and return what we have. Audnexus has its own rate limits; same approach.

## Metadata Field Mapping

| ParsedMetadata field | Audible API source | Audnexus source |
|---------------------|-------------------|-----------------|
| title | `title` | `title` |
| subtitle | `subtitle` | `subtitle` |
| authors | `authors[].name` | `authors[].name` |
| narrators | `narrators[].name` | `narrators[].name` |
| description | `publisher_summary` (strip HTML) | `description` (strip HTML) |
| publisher | `publisher_name` | `publisherName` |
| releaseDate | `release_date` → ISO 8601 | `releaseDate` → ISO 8601 |
| series | `series[0].title` | `seriesPrimary.name` |
| seriesNumber | `series[0].sequence` (parse to number) | `seriesPrimary.position` (parse to number) |
| genres | `category_ladders` leaf names (single-product only) | `genres[].name` where type="genre" (first 3) |
| tags | — | `genres[].name` where type="tag" (remainder) |
| coverUrl | `product_images.1024` or `product_images.500` | `image` |
| url | Constructed: `https://www.audible.{tld}/pd/{ASIN}` | — |
| identifiers | `[{type: "asin", value: asin}]` | `[{type: "asin", value: asin}]` |
| confidence | 1.0 for ASIN lookup, Levenshtein-based for search | Same |

## Testing Strategy

Follow existing plugin test patterns:

- **api.test.ts**: Mock `shisho.http.fetch`, test each API function (search, ASIN lookup, Audnexus fetch) for success, HTTP errors, malformed JSON
- **lookup.test.ts**: Mock `api` module, test all three tiers, marketplace iteration, deduplication, Levenshtein filtering, Audnexus fallback behavior
- **mapping.test.ts**: Test field mapping for both Audible API and Audnexus responses, edge cases (missing fields, HTML stripping, date parsing, series number extraction)
