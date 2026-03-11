import type { GRBookPageData, GRSchemaOrg } from "./types";

/**
 * Parse a Goodreads book page HTML to extract structured metadata.
 */
export function parseBookPage(html: string): GRBookPageData {
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
      name: data.name,
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

  const regex = /href="\/genres\/([^"]+)"[^>]*>([^<]+)<\/a>/gi;
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

  // Look for "Published ... by Publisher" (requires "by" so it won't match "First published" lines)
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
  return html.replace(/<[^>]+>/g, "").trim();
}
