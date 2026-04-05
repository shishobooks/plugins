import type { GRBookPageData, GRSchemaOrg } from "./types";

/**
 * Parse a Goodreads book page HTML to extract structured metadata.
 *
 * Tries __NEXT_DATA__ Apollo state first (rich structured data), then falls
 * back to JSON-LD + regex scraping for pages where Apollo data is unavailable.
 */
export function parseBookPage(html: string): GRBookPageData {
  const apolloData = extractFromNextData(html);
  if (apolloData) return apolloData;

  // Fallback: regex-based extraction
  const schemaOrg = extractSchemaOrg(html);
  const description = extractDescription(html);
  const seriesInfo = extractSeries(html, schemaOrg);
  const genres = extractGenres(html);
  const pubInfo = extractPublicationInfo(html);

  return {
    schemaOrg,
    description,
    series: seriesInfo.series,
    seriesNumber: seriesInfo.seriesNumber,
    genres,
    publisher: pubInfo.publisher,
    publishDate: pubInfo.publishDate,
  };
}

/**
 * Extract book data from __NEXT_DATA__ Apollo state.
 *
 * Goodreads embeds rich structured data in a Next.js Apollo cache. This is the
 * most reliable data source: clean text (no HTML entities), full descriptions,
 * structured genres, and millisecond timestamps for dates.
 */
export function extractFromNextData(html: string): GRBookPageData | null {
  const match = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;

  try {
    const nextData = JSON.parse(match[1]);
    const apolloState = nextData?.props?.pageProps?.apolloState;
    if (!apolloState) return null;

    // Find the Book entity with full data (not a minimal stub).
    // Apollo state may contain multiple Book entities — stubs (v1) have only
    // __typename/id/legacyId/webUrl, while the full entity (v3) has title,
    // imageUrl, description, genres, etc.
    const bookEntry = Object.entries(apolloState).find(
      ([key, val]) =>
        key.startsWith("Book:") &&
        (val as Record<string, unknown>).__typename === "Book" &&
        (val as Record<string, unknown>).title !== undefined,
    );
    if (!bookEntry) return null;

    const book = bookEntry[1] as Record<string, unknown>;

    // Build schema.org-compatible data from Apollo
    const schemaOrg = buildSchemaOrgFromApollo(book, apolloState);

    // Description — prefer stripped variant, fall back to HTML description
    const strippedDesc = book['description({"stripped":true})'] as
      | string
      | null;
    const htmlDesc = book.description as string | null;
    let description: string | null = null;
    if (strippedDesc) {
      description = strippedDesc.replace(/\r\n/g, "\n").trim();
    } else if (htmlDesc) {
      description = stripHTML(htmlDesc);
    }

    // Series
    const { series, seriesNumber } = extractSeriesFromApollo(book, apolloState);

    // Genres
    const genres = extractGenresFromApollo(book);

    // Publication info from details
    const details = book.details as Record<string, unknown> | undefined;
    let publisher: string | null = null;
    let publishDate: string | null = null;

    if (details) {
      if (typeof details.publisher === "string" && details.publisher) {
        publisher = details.publisher;
      }
      if (typeof details.publicationTime === "number") {
        publishDate = formatTimestamp(details.publicationTime);
      }
    }

    return {
      schemaOrg,
      description,
      series,
      seriesNumber,
      genres,
      publisher,
      publishDate,
    };
  } catch {
    return null;
  }
}

/**
 * Build a GRSchemaOrg-compatible object from Apollo state.
 */
function buildSchemaOrgFromApollo(
  book: Record<string, unknown>,
  apolloState: Record<string, unknown>,
): GRSchemaOrg {
  const details = book.details as Record<string, unknown> | undefined;
  const language = details?.language as Record<string, unknown> | undefined;

  // Resolve authors from contributor edges
  const authors: Array<{ name: string; url: string }> = [];
  const primaryEdge = book.primaryContributorEdge as
    | Record<string, unknown>
    | undefined;
  if (primaryEdge?.node) {
    const ref = (primaryEdge.node as Record<string, string>).__ref;
    if (ref) {
      const contributor = apolloState[ref] as
        | Record<string, unknown>
        | undefined;
      if (contributor?.name) {
        authors.push({
          name: contributor.name as string,
          url: (contributor.webUrl as string) ?? "",
        });
      }
    }
  }

  // Also check secondaryContributorEdges
  const secondaryEdges = book.secondaryContributorEdges as
    | Array<Record<string, unknown>>
    | undefined;
  if (secondaryEdges) {
    for (const edge of secondaryEdges) {
      if (edge.role === "Author" || edge.role === "author") {
        const ref = (edge.node as Record<string, string>)?.__ref;
        if (ref) {
          const contributor = apolloState[ref] as
            | Record<string, unknown>
            | undefined;
          if (contributor?.name) {
            authors.push({
              name: contributor.name as string,
              url: (contributor.webUrl as string) ?? "",
            });
          }
        }
      }
    }
  }

  return {
    name: (book.titleComplete as string) ?? (book.title as string) ?? "",
    image: (book.imageUrl as string) ?? undefined,
    bookFormat: (details?.format as string) ?? undefined,
    numberOfPages: (details?.numPages as number) ?? undefined,
    inLanguage: (language?.name as string) ?? undefined,
    isbn: (details?.isbn13 as string) ?? (details?.isbn as string) ?? undefined,
    author: authors.length > 0 ? authors : undefined,
  };
}

/**
 * Extract series info from Apollo bookSeries array.
 */
function extractSeriesFromApollo(
  book: Record<string, unknown>,
  apolloState: Record<string, unknown>,
): { series: string | null; seriesNumber: number | null } {
  const bookSeries = book.bookSeries as
    | Array<Record<string, unknown>>
    | undefined;
  if (!bookSeries || bookSeries.length === 0) {
    return { series: null, seriesNumber: null };
  }

  const entry = bookSeries[0];
  const position = entry.userPosition as string | undefined;
  const seriesRef = (entry.series as Record<string, string>)?.__ref;

  let seriesName: string | null = null;
  if (seriesRef) {
    const seriesObj = apolloState[seriesRef] as
      | Record<string, unknown>
      | undefined;
    if (seriesObj?.title) {
      seriesName = seriesObj.title as string;
    }
  }

  return {
    series: seriesName,
    seriesNumber: position ? parseFloat(position) : null,
  };
}

/**
 * Extract genre names from Apollo bookGenres array.
 */
function extractGenresFromApollo(book: Record<string, unknown>): string[] {
  const bookGenres = book.bookGenres as
    | Array<Record<string, unknown>>
    | undefined;
  if (!bookGenres) return [];

  const genres: string[] = [];
  for (const entry of bookGenres) {
    const genre = entry.genre as Record<string, unknown> | undefined;
    if (genre?.name && typeof genre.name === "string") {
      genres.push(genre.name);
    }
  }
  return genres;
}

/**
 * Format a millisecond Unix timestamp as a human-readable date string.
 * Returns format like "January 6, 2021" to match Goodreads date format.
 */
function formatTimestamp(ms: number): string {
  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const date = new Date(ms);
  const month = MONTH_NAMES[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}

/**
 * Extract Schema.org JSON-LD from the page.
 */
export function extractSchemaOrg(html: string): GRSchemaOrg | null {
  const match = html.match(
    /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    if (data["@type"] !== "Book") return null;

    const authors = Array.isArray(data.author)
      ? data.author
      : data.author
        ? [data.author]
        : undefined;

    return {
      name: decodeHTMLEntities(data.name ?? ""),
      image: data.image,
      bookFormat: data.bookFormat,
      numberOfPages: data.numberOfPages,
      inLanguage: data.inLanguage,
      isbn: data.isbn,
      author: authors?.map((a: { name: string; url: string }) => ({
        name: a.name,
        url: a.url,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Extract series name and number.
 *
 * Tries two approaches:
 * 1. Parse from JSON-LD title: "Book Title (Series Name, #N)"
 * 2. Look for series links in page HTML: href="/series/..."
 */
export function extractSeries(
  html: string,
  schemaOrg: GRSchemaOrg | null,
): { series: string | null; seriesNumber: number | null } {
  // Try parsing from JSON-LD title: "Title (Series Name, #N)"
  if (schemaOrg?.name) {
    const match = schemaOrg.name.match(/\(([^)]+),\s*#([\d.]+)\)\s*$/);
    if (match) {
      return {
        series: match[1].trim(),
        seriesNumber: parseFloat(match[2]),
      };
    }
  }

  // Try finding series link in HTML: <a href="/series/...">Series Name</a> #N
  const seriesMatch = html.match(
    /href="\/series\/[^"]*"[^>]*>([^<]+)<\/a>\s*#([\d.]+)/i,
  );
  if (seriesMatch) {
    return {
      series: seriesMatch[1].trim(),
      seriesNumber: parseFloat(seriesMatch[2]),
    };
  }

  return { series: null, seriesNumber: null };
}

/**
 * Extract genre/shelf names from the page.
 * Genres appear as links to /genres/<genre-name> paths.
 */
export function extractGenres(html: string): string[] {
  const genres: string[] = [];
  const seen = new Set<string>();

  const regex =
    /href="(?:https:\/\/www\.goodreads\.com)?\/genres\/([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const name = match[2].trim();
    const lower = name.toLowerCase();
    if (!seen.has(lower) && name.length > 0) {
      seen.add(lower);
      genres.push(name);
    }
  }

  return genres;
}

/**
 * Extract the book description from the page.
 * Tries og:description meta tag, then twitter:description.
 */
export function extractDescription(html: string): string | null {
  // Try og:description meta tag (either attribute order)
  const ogMatch =
    html.match(
      /<meta\s+(?:property|name)="og:description"\s+content="([^"]*)"[^>]*>/i,
    ) ??
    html.match(
      /<meta\s+content="([^"]*)"\s+(?:property|name)="og:description"[^>]*>/i,
    );
  if (ogMatch) {
    return decodeHTMLEntities(ogMatch[1]);
  }

  // Try twitter:description
  const twitterMatch =
    html.match(
      /<meta\s+(?:property|name)="twitter:description"\s+content="([^"]*)"[^>]*>/i,
    ) ??
    html.match(
      /<meta\s+content="([^"]*)"\s+(?:property|name)="twitter:description"[^>]*>/i,
    );
  if (twitterMatch) {
    return decodeHTMLEntities(twitterMatch[1]);
  }

  return null;
}

/**
 * Extract publisher and publication date from the page.
 */
export function extractPublicationInfo(html: string): {
  publisher: string | null;
  publishDate: string | null;
} {
  let publishDate: string | null = null;
  let publisher: string | null = null;

  // Look for "First published Month Day, Year"
  const firstPubMatch = html.match(
    /First published\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
  );
  if (firstPubMatch) {
    publishDate = firstPubMatch[1].trim();
  }

  // Look for "Published ... by Publisher". The required "by" keyword prevents matching "First
  // published" lines (which don't include a publisher). If a "First published" line did include
  // "by Publisher", the date would already be captured above and only the publisher is extracted.
  const pubByMatch = html.match(
    /Published\s+([A-Z][a-z]+(?:\s+\d{1,2},?)?\s+\d{4})\s+by\s+([^<\n]+?)(?:\s*<|\s*\n)/i,
  );
  if (pubByMatch) {
    if (!publishDate) {
      publishDate = pubByMatch[1].trim();
    }
    publisher = pubByMatch[2].trim();
  }

  // Fallback: "Published Date" without publisher
  if (!publishDate) {
    const pubDateMatch = html.match(
      /Published\s+([A-Z][a-z]+(?:\s+\d{1,2},?)?\s+\d{4})(?:\s*<|\s*\n)/i,
    );
    if (pubDateMatch) {
      publishDate = pubDateMatch[1].trim();
    }
  }

  return { publisher, publishDate };
}

/**
 * Decode common HTML entities.
 */
export function decodeHTMLEntities(text: string): string {
  if (!text) return text ?? "";
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Strip HTML tags from a string.
 */
export function stripHTML(html: string): string {
  if (!html) return "";
  return decodeHTMLEntities(html.replace(/<[^>]+>/g, "")).trim();
}
