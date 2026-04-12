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
 * Handles both top-level objects and entities nested inside a @graph array.
 */
function findBookEntity(blocks: unknown[]): JsonLdBook | null {
  const isBook = (entity: unknown): entity is JsonLdBook => {
    if (!entity || typeof entity !== "object") return false;
    const typed = entity as JsonLdBook;
    const type = typed["@type"];
    return type === "Book" || (Array.isArray(type) && type.includes("Book"));
  };

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;

    // Check if the block itself is a Book.
    if (isBook(block)) return block;

    // Check if the block wraps entities in a @graph array.
    const graphBlock = block as { "@graph"?: unknown[] };
    if (Array.isArray(graphBlock["@graph"])) {
      for (const entity of graphBlock["@graph"]) {
        if (isBook(entity)) return entity;
      }
    }
  }
  return null;
}

/**
 * Pick an ISBN from a Book entity, preferring ebook editions over other
 * formats. Falls back to the top-level isbn if workExample is absent.
 *
 * Kodansha's bookFormat values may be full schema.org URIs
 * (e.g., "https://schema.org/EBook") or plain strings ("EBook").
 * Both are handled by testing whether the value ends with "ebook",
 * "e-book", or "digital" (case-insensitive).
 */
export function pickIsbn(book: JsonLdBook): {
  isbn13?: string;
  isbn10?: string;
} {
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
 * Extract the og:description meta tag content from HTML.
 * Kodansha does not include a description field in the Book JSON-LD, but
 * the page always has an og:description meta tag with the synopsis.
 */
function extractOgDescription(html: string): string | undefined {
  const m = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  );
  if (!m) {
    // Try the other attribute order: content before property.
    const m2 = html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
    );
    if (m2) return m2[1].trim();
    return undefined;
  }
  return m[1].trim();
}

/**
 * Parse a Kodansha product page into VolumeMetadata using JSON-LD.
 * Falls back to og:description for the synopsis since Kodansha does not
 * include a description field in their Book JSON-LD.
 */
export function parseProduct(html: string, url: string): VolumeMetadata | null {
  const blocks = extractJsonLd(html);
  const book = findBookEntity(blocks);
  if (!book) return null;

  const metadata: VolumeMetadata = { url };

  if (book.name) metadata.title = book.name;

  // Description: prefer the JSON-LD field, fall back to og:description.
  const descriptionRaw = book.description ?? extractOgDescription(html);
  if (descriptionRaw) metadata.description = stripHTML(descriptionRaw);

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
