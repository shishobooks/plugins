import {
  fetchAudnexusBook,
  fetchProduct,
  getMarketplaces,
  searchProducts,
} from "../api";
import { searchForBooks } from "../lookup";
import type { AudibleProduct, AudnexusBook } from "../types";
import type { SearchContext } from "@shisho/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  getMarketplaces: vi.fn(),
  searchProducts: vi.fn(),
  fetchProduct: vi.fn(),
  fetchAudnexusBook: vi.fn(),
}));

const mockedGetMarketplaces = vi.mocked(getMarketplaces);
const mockedSearchProducts = vi.mocked(searchProducts);
const mockedFetchProduct = vi.mocked(fetchProduct);
const mockedFetchAudnexusBook = vi.mocked(fetchAudnexusBook);

function makeContext(overrides: Partial<SearchContext> = {}): SearchContext {
  return { query: "", ...overrides };
}

const sampleProduct: AudibleProduct = {
  asin: "B08G9PRS1K",
  title: "Project Hail Mary",
  subtitle: "A Novel",
  authors: [{ name: "Andy Weir" }],
  narrators: [{ name: "Ray Porter" }],
  publisher_name: "Audible Studios",
  publisher_summary: "Ryland Grace is the sole survivor.",
  release_date: "2021-05-04",
  series: [{ title: "Hail Mary", sequence: "1" }],
  product_images: { "1024": "https://m.media-amazon.com/images/I/cover.jpg" },
};

const sampleAudnexusBook: AudnexusBook = {
  asin: "B08G9PRS1K",
  title: "Project Hail Mary",
  authors: [{ name: "Andy Weir" }],
  narrators: [{ name: "Ray Porter" }],
  publisherName: "Audible Studios",
  summary: "Ryland Grace is the sole survivor.",
  releaseDate: "2021-05-04",
  image: "https://m.media-amazon.com/images/I/cover.jpg",
  seriesPrimary: { name: "Hail Mary", position: "1" },
  genres: [
    { asin: "1", name: "Science Fiction", type: "genre" },
    { asin: "2", name: "Space Opera", type: "tag" },
  ],
};

function setupDefaultMocks() {
  mockedGetMarketplaces.mockReturnValue(["us"]);
  mockedFetchAudnexusBook.mockReturnValue(null);
  mockedFetchProduct.mockReturnValue(null);
  mockedSearchProducts.mockReturnValue(null);
}

describe("searchForBooks", () => {
  describe("Tier 1: ASIN lookup", () => {
    it("tries Audnexus first when ASIN is available", () => {
      setupDefaultMocks();
      mockedFetchAudnexusBook.mockReturnValue(sampleAudnexusBook);

      const context = makeContext({
        identifiers: [{ type: "asin", value: "B08G9PRS1K" }],
      });

      const results = searchForBooks(context);

      expect(mockedFetchAudnexusBook).toHaveBeenCalledWith("B08G9PRS1K", "us");
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
      expect(results[0].title).toBe("Project Hail Mary");
      expect(results[0].genres).toEqual(["Science Fiction"]);
      expect(results[0].tags).toEqual(["Space Opera"]);
    });

    it("falls back to Audible API when Audnexus fails", () => {
      setupDefaultMocks();
      mockedFetchAudnexusBook.mockReturnValue(null);
      mockedFetchProduct.mockReturnValue(sampleProduct);

      const context = makeContext({
        identifiers: [{ type: "asin", value: "B08G9PRS1K" }],
      });

      const results = searchForBooks(context);

      expect(mockedFetchAudnexusBook).toHaveBeenCalled();
      expect(mockedFetchProduct).toHaveBeenCalledWith("us", "B08G9PRS1K");
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
    });

    it("returns empty when both Audnexus and Audible API fail for ASIN", () => {
      setupDefaultMocks();

      const context = makeContext({
        identifiers: [{ type: "asin", value: "B08G9PRS1K" }],
      });

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("skips non-ASIN identifiers", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([]);

      const context = makeContext({
        query: "Test",
        identifiers: [{ type: "isbn_13", value: "9780593135204" }],
      });

      searchForBooks(context);
      expect(mockedFetchAudnexusBook).not.toHaveBeenCalled();
      expect(mockedFetchProduct).not.toHaveBeenCalled();
    });
  });

  describe("Tier 2: Title + Author search", () => {
    it("searches across all configured marketplaces", () => {
      setupDefaultMocks();
      mockedGetMarketplaces.mockReturnValue(["us", "uk"]);
      mockedSearchProducts
        .mockReturnValueOnce([sampleProduct])
        .mockReturnValueOnce([]);

      const context = makeContext({ query: "Project Hail Mary" });
      searchForBooks(context);

      expect(mockedSearchProducts).toHaveBeenCalledWith(
        "us",
        "Project Hail Mary",
        undefined,
      );
      expect(mockedSearchProducts).toHaveBeenCalledWith(
        "uk",
        "Project Hail Mary",
        undefined,
      );
    });

    it("includes author in search when available", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([sampleProduct]);

      const context = makeContext({
        query: "Project Hail Mary",
        author: "Andy Weir",
      });
      searchForBooks(context);

      expect(mockedSearchProducts).toHaveBeenCalledWith(
        "us",
        "Project Hail Mary",
        "Andy Weir",
      );
    });

    it("deduplicates results by ASIN across marketplaces", () => {
      setupDefaultMocks();
      mockedGetMarketplaces.mockReturnValue(["us", "uk"]);
      mockedSearchProducts
        .mockReturnValueOnce([sampleProduct])
        .mockReturnValueOnce([sampleProduct]);

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(results).toHaveLength(1);
    });

    it("keeps loosely-matching results with low confidence", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([
        { ...sampleProduct, title: "A Completely Different Title Altogether" },
      ]);

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBeLessThan(0.5);
    });

    it("computes confidence from Levenshtein distance", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([sampleProduct]);

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
    });

    it("gives high confidence when query matches title ignoring subtitle", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([
        { ...sampleProduct, title: "Yesteryear: A GMA Book Club Pick" },
      ]);

      const context = makeContext({ query: "Yesteryear" });
      const results = searchForBooks(context);

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
    });

    it("preserves API result order", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([
        { ...sampleProduct, asin: "A1", title: "Project Hail Mary" },
        { ...sampleProduct, asin: "A2", title: "Project Hail" },
        { ...sampleProduct, asin: "A3", title: "Project Hail Mary" },
      ]);

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(results.map((r) => r.identifiers?.[0].value)).toEqual([
        "A1",
        "A2",
        "A3",
      ]);
    });

    it("enriches with Audnexus genres, tags, and cover on search results", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([sampleProduct]);
      mockedFetchAudnexusBook.mockReturnValue(sampleAudnexusBook);

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(mockedFetchAudnexusBook).toHaveBeenCalledWith("B08G9PRS1K", "us");
      expect(results[0].genres).toEqual(["Science Fiction"]);
      expect(results[0].tags).toEqual(["Space Opera"]);
    });

    it("prefers Audnexus cover URL over Audible API cover", () => {
      setupDefaultMocks();
      const productWith1024Cover: AudibleProduct = {
        ...sampleProduct,
        product_images: {
          "1024": "https://m.media-amazon.com/images/I/1024.jpg",
        },
      };
      mockedSearchProducts.mockReturnValue([productWith1024Cover]);
      mockedFetchAudnexusBook.mockReturnValue({
        ...sampleAudnexusBook,
        image: "https://m.media-amazon.com/images/I/full-res.jpg",
      });

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(results[0].coverUrl).toBe(
        "https://m.media-amazon.com/images/I/full-res.jpg",
      );
    });

    it("prefers Audnexus series over Audible API series", () => {
      setupDefaultMocks();
      const productWithMultipleSeries: AudibleProduct = {
        ...sampleProduct,
        series: [
          { title: "The Hail Mary Sequence", sequence: "12" },
          { title: "Hail Mary", sequence: "1" },
        ],
      };
      mockedSearchProducts.mockReturnValue([productWithMultipleSeries]);
      mockedFetchAudnexusBook.mockReturnValue({
        ...sampleAudnexusBook,
        seriesPrimary: { name: "Hail Mary", position: "1" },
      });

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(results[0].series).toBe("Hail Mary");
      expect(results[0].seriesNumber).toBe(1);
    });

    it("includes ISBN from Audnexus in identifiers", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([sampleProduct]);
      mockedFetchAudnexusBook.mockReturnValue({
        ...sampleAudnexusBook,
        isbn: "9781603935470",
      });

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(results[0].identifiers).toEqual([
        { type: "asin", value: "B08G9PRS1K" },
        { type: "isbn_13", value: "9781603935470" },
      ]);
    });

    it("still returns results when Audnexus enrichment fails", () => {
      setupDefaultMocks();
      mockedSearchProducts.mockReturnValue([sampleProduct]);
      mockedFetchAudnexusBook.mockReturnValue(null);

      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);

      expect(results).toHaveLength(1);
      expect(results[0].genres).toBeUndefined();
    });

    it("returns empty when query is empty", () => {
      setupDefaultMocks();
      const context = makeContext({ query: "" });
      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("returns empty when search returns null", () => {
      setupDefaultMocks();
      const context = makeContext({ query: "Project Hail Mary" });
      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });
  });
});
