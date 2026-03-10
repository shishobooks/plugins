# Open Library Enricher Design

> **Note:** This design predates the two-phase search/enrich architecture in `@shisho/plugin-types` 0.0.18+. The plugin now implements `search()` + `enrich()` instead of a single `enrich()` hook. See the source code for the current implementation.

## Overview

This document describes the implementation design for the Open Library metadata enricher plugin for Shisho. The plugin fetches book metadata from the Open Library API to enrich books in a user's library.

## Lookup Strategy

The plugin attempts lookups in priority order, stopping at the first success:

```
┌─────────────────────────────────────────────────────────┐
│  1. Check for existing Open Library IDs                 │
│     - "openlibrary_edition" → /books/{id}.json          │
│     - "openlibrary_work" → /works/{id}.json             │
├─────────────────────────────────────────────────────────┤
│  2. ISBN Lookup                                         │
│     - /isbn/{isbn}.json (returns edition directly)      │
│     - Then fetch /works/{work_id}.json for full data    │
├─────────────────────────────────────────────────────────┤
│  3. Title + Author Search (fallback)                    │
│     - /search.json?title={title}&author={author}        │
│     - Take top result, fetch work details               │
│     - Requires Levenshtein distance ≤ 5 on title        │
│     - If authors in context, require author overlap     │
└─────────────────────────────────────────────────────────┘
```

## Data Mapping

### Metadata Fields

| Shisho Field | Open Library Source | Notes |
|--------------|---------------------|-------|
| `title` | edition.title or work.title | Edition preferred |
| `subtitle` | edition.subtitle | |
| `authors` | work.authors → fetch /authors/{id}.json | Get full author names |
| `narrators` | edition.contributors where role = "Narrator/Reader" | For audiobooks |
| `description` | work.description | May be string or `{value: string}` |
| `publisher` | edition.publishers[0] | First publisher |
| `releaseDate` | edition.publish_date | Parse to ISO 8601 |
| `series` | edition.series[0] → work.series[0] → subjects "series:" tag | Fallback chain |
| `seriesNumber` | Parse from series string | e.g., "Book 2" → 2 |
| `genres` | subjects with "genre:" prefix | Title case values |
| `tags` | subjects without ":" prefix | Title case values |
| `coverData` | covers.openlibrary.org/b/id/{cover_id}-L.jpg | Large size, always fetch |
| `coverMimeType` | `"image/jpeg"` | OL serves JPEG |

### Subject Parsing

Open Library subjects use a tagging convention:

```typescript
for (const subject of work.subjects) {
  if (subject.startsWith("series:")) {
    // Use as series fallback if no series from edition/work
    seriesFallback = toTitleCase(subject.slice(7));
  } else if (subject.startsWith("genre:")) {
    // Add to genres
    genres.push(toTitleCase(subject.slice(6)));
  } else {
    // Add to tags
    tags.push(toTitleCase(subject));
  }
}
```

### Identifiers

| Identifier Type | Open Library Source |
|-----------------|---------------------|
| `openlibrary_work` | work.key (e.g., "/works/OL123W" → "OL123W") |
| `openlibrary_edition` | edition.key (e.g., "/books/OL456M" → "OL456M") |
| `isbn_13` | edition.isbn_13[] (all values) |
| `isbn_10` | edition.isbn_10[] (all values) |
| `goodreads` | edition.identifiers.goodreads[] |

Multiple identifiers of the same type are supported (e.g., multiple ISBNs).

## Architecture

```
src/
├── index.ts              # Plugin entry point, exports ShishoPlugin
├── lookup.ts             # Lookup strategy (OL ID → ISBN → search)
├── api.ts                # Open Library API calls (fetch wrappers)
├── mapping.ts            # Transform OL responses → ParsedMetadata
└── utils.ts              # Title case, date parsing, ID extraction, Levenshtein
```

### Flow

```
enrich(context)
  → lookup.findBook(context.parsedMetadata, context.book)
      → api.fetchByEditionId() or
        api.fetchByWorkId() or
        api.fetchByISBN() or
        api.searchByTitleAuthor()
  → mapping.toMetadata(olEdition, olWork)
      → utils.toTitleCase(), utils.parseDate(), etc.
  → fetch cover if available
  → return { modified: true, metadata }
```

## Error Handling

### API Errors

- **404 (not found):** Try next lookup method in chain, eventually return `{ modified: false }`
- **5xx / network errors:** Log warning, return `{ modified: false }`
- **Rate limiting (429):** Log warning, return `{ modified: false }` (no retry for now)

### Data Edge Cases

- `description` can be string or `{ type: "/type/text", value: "..." }` → normalize to string
- `publish_date` formats vary ("1954", "June 1954", "Jun 15, 1954") → best-effort ISO 8601 parse, skip if unparseable
- Multiple ISBNs in response → save all as separate identifiers
- No cover_id → skip cover fetch, don't set coverData/coverMimeType
- Author lookup fails → use author name from search result if available, skip if not

### Search Fallback Confidence

- Normalize both titles (lowercase, strip punctuation)
- Calculate Levenshtein distance
- Accept if distance ≤ 5
- If authors present in context, also require at least one author name overlap

## API Details

### User-Agent

```
ShishoPlugin/0.1.0 (open-library-enricher; github.com/shishobooks/plugins)
```

### Endpoints Used

| Purpose | Endpoint |
|---------|----------|
| Fetch edition by ID | `https://openlibrary.org/books/{edition_id}.json` |
| Fetch work by ID | `https://openlibrary.org/works/{work_id}.json` |
| Fetch by ISBN | `https://openlibrary.org/isbn/{isbn}.json` |
| Search by title/author | `https://openlibrary.org/search.json?title={title}&author={author}` |
| Fetch author details | `https://openlibrary.org/authors/{author_id}.json` |
| Fetch cover image | `https://covers.openlibrary.org/b/id/{cover_id}-L.jpg` |

### Domain Whitelist

The manifest declares `httpAccess.domains: ["openlibrary.org"]`. Note: `covers.openlibrary.org` is a subdomain, so this should work. If not, we may need to add it explicitly.
