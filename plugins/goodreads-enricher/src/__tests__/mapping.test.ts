import { fetchCover } from "../api";
import { toMetadata } from "../mapping";
import type { GRAutocompleteResult, GRLookupResult } from "../types";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  fetchCover: vi.fn(),
}));

vi.mock("../parsing", () => ({
  stripHTML: vi.fn((html: string) => html.replace(/<[^>]+>/g, "").trim()),
}));

const mockedFetchCover = vi.mocked(fetchCover);

const baseAutocomplete: GRAutocompleteResult = {
  imageUrl: "https://i.gr-assets.com/images/books/5907._SY75_.jpg",
  bookId: "5907",
  workId: "1540236",
  bookUrl: "/book/show/5907",
  title: "The Hobbit, or There and Back Again",
  bookTitleBare: "The Hobbit, or There and Back Again",
  numPages: 366,
  avgRating: "4.30",
  ratingsCount: 4490863,
  author: {
    id: 656983,
    name: "J.R.R. Tolkien",
    isGoodreadsAuthor: false,
    profileUrl: "https://www.goodreads.com/author/show/656983",
    worksListUrl: "https://www.goodreads.com/author/list/656983",
  },
  description: {
    html: "<b>In a hole</b> in the ground there lived a hobbit.",
    truncated: true,
    fullContentUrl: "https://www.goodreads.com/book/show/5907",
  },
};

function makeResult(overrides: Partial<GRLookupResult> = {}): GRLookupResult {
  return {
    bookId: "5907",
    autocomplete: overrides.autocomplete ?? baseAutocomplete,
    pageData: {
      schemaOrg: null,
      description: null,
      series: null,
      seriesNumber: null,
      genres: [],
      publisher: null,
      publishDate: null,
      ...overrides.pageData,
    },
  };
}

describe("toMetadata", () => {
  describe("basic field mapping", () => {
    it("maps all fields from a full result", () => {
      const result = makeResult({
        pageData: {
          schemaOrg: {
            name: "The Hobbit, or There and Back Again",
            isbn: "9780261102217",
            image: "https://m.media-amazon.com/images/books/5907.jpg",
            author: [
              { name: "J.R.R. Tolkien", url: "/author/656983" },
              { name: "Douglas A. Anderson", url: "/author/1582" },
            ],
          },
          description: "A fantasy novel about a hobbit's adventure.",
          series: "Middle-earth",
          seriesNumber: 1,
          genres: ["Fantasy", "Classics", "Fiction", "Adventure"],
          publisher: "HarperCollins",
          publishDate: "September 21, 1937",
        },
      });
      mockedFetchCover.mockReturnValue(new ArrayBuffer(8));

      const metadata = toMetadata(result);

      expect(metadata.title).toBe("The Hobbit, or There and Back Again");
      expect(metadata.authors).toEqual([
        { name: "J.R.R. Tolkien" },
        { name: "Douglas A. Anderson" },
      ]);
      expect(metadata.description).toBe(
        "A fantasy novel about a hobbit's adventure.",
      );
      expect(metadata.publisher).toBe("HarperCollins");
      expect(metadata.releaseDate).toBe("1937-09-21T00:00:00Z");
      expect(metadata.series).toBe("Middle-earth");
      expect(metadata.seriesNumber).toBe(1);
      expect(metadata.genres).toEqual(["Fantasy", "Classics", "Fiction"]);
      expect(metadata.tags).toEqual(["Adventure"]);
      expect(metadata.coverData).toBeInstanceOf(ArrayBuffer);
      expect(metadata.coverMimeType).toBe("image/jpeg");
      expect(metadata.identifiers).toEqual([
        { type: "goodreads", value: "5907" },
        { type: "isbn_13", value: "9780261102217" },
      ]);
    });

    it("handles minimal result without errors", () => {
      const result = makeResult();
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);

      expect(metadata.title).toBe("The Hobbit, or There and Back Again");
      expect(metadata.authors).toEqual([{ name: "J.R.R. Tolkien" }]);
      expect(metadata.publisher).toBeUndefined();
      expect(metadata.series).toBeUndefined();
      expect(metadata.genres).toBeUndefined();
    });
  });

  describe("title cleaning", () => {
    it("removes series suffix from title", () => {
      const result = makeResult({
        autocomplete: {
          ...baseAutocomplete,
          bookTitleBare: "The Name of the Wind (The Kingkiller Chronicle, #1)",
        },
        pageData: {
          schemaOrg: null,
          description: null,
          series: "The Kingkiller Chronicle",
          seriesNumber: 1,
          genres: [],
          publisher: null,
          publishDate: null,
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.title).toBe("The Name of the Wind");
    });

    it("keeps title unchanged when no series", () => {
      const result = makeResult();
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.title).toBe("The Hobbit, or There and Back Again");
    });
  });

  describe("author mapping", () => {
    it("prefers JSON-LD authors over autocomplete", () => {
      const result = makeResult({
        pageData: {
          schemaOrg: {
            name: "Test",
            author: [
              { name: "Author One", url: "/author/1" },
              { name: "Author Two", url: "/author/2" },
            ],
          },
          description: null,
          series: null,
          seriesNumber: null,
          genres: [],
          publisher: null,
          publishDate: null,
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.authors).toEqual([
        { name: "Author One" },
        { name: "Author Two" },
      ]);
    });

    it("falls back to autocomplete author when JSON-LD has none", () => {
      const result = makeResult();
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.authors).toEqual([{ name: "J.R.R. Tolkien" }]);
    });
  });

  describe("description mapping", () => {
    it("prefers page description over autocomplete", () => {
      const result = makeResult({
        pageData: {
          schemaOrg: null,
          description: "Full page description.",
          series: null,
          seriesNumber: null,
          genres: [],
          publisher: null,
          publishDate: null,
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.description).toBe("Full page description.");
    });

    it("falls back to autocomplete description", () => {
      const result = makeResult();
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.description).toBe(
        "In a hole in the ground there lived a hobbit.",
      );
    });
  });

  describe("genre/tag splitting", () => {
    it("splits genres into genres (first 3) and tags (rest)", () => {
      const result = makeResult({
        pageData: {
          schemaOrg: null,
          description: null,
          series: null,
          seriesNumber: null,
          genres: [
            "Fantasy",
            "Classics",
            "Fiction",
            "Adventure",
            "Young Adult",
          ],
          publisher: null,
          publishDate: null,
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.genres).toEqual(["Fantasy", "Classics", "Fiction"]);
      expect(metadata.tags).toEqual(["Adventure", "Young Adult"]);
    });

    it("keeps all as genres when 3 or fewer", () => {
      const result = makeResult({
        pageData: {
          schemaOrg: null,
          description: null,
          series: null,
          seriesNumber: null,
          genres: ["Fantasy", "Fiction"],
          publisher: null,
          publishDate: null,
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.genres).toEqual(["Fantasy", "Fiction"]);
      expect(metadata.tags).toBeUndefined();
    });
  });

  describe("identifier collection", () => {
    it("includes Goodreads ID and ISBN-13", () => {
      const result = makeResult({
        pageData: {
          schemaOrg: { name: "Test", isbn: "9780756404079" },
          description: null,
          series: null,
          seriesNumber: null,
          genres: [],
          publisher: null,
          publishDate: null,
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.identifiers).toEqual([
        { type: "goodreads", value: "5907" },
        { type: "isbn_13", value: "9780756404079" },
      ]);
    });

    it("handles ISBN-10", () => {
      const result = makeResult({
        pageData: {
          schemaOrg: { name: "Test", isbn: "0261102214" },
          description: null,
          series: null,
          seriesNumber: null,
          genres: [],
          publisher: null,
          publishDate: null,
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.identifiers).toEqual([
        { type: "goodreads", value: "5907" },
        { type: "isbn_10", value: "0261102214" },
      ]);
    });

    it("includes only Goodreads ID when no ISBN", () => {
      const result = makeResult();
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.identifiers).toEqual([
        { type: "goodreads", value: "5907" },
      ]);
    });
  });

  describe("cover fetching", () => {
    it("fetches cover from JSON-LD image URL", () => {
      const result = makeResult({
        pageData: {
          schemaOrg: {
            name: "Test",
            image: "https://m.media-amazon.com/images/books/5907.jpg",
          },
          description: null,
          series: null,
          seriesNumber: null,
          genres: [],
          publisher: null,
          publishDate: null,
        },
      });
      const coverBuffer = new ArrayBuffer(16);
      mockedFetchCover.mockReturnValue(coverBuffer);

      const metadata = toMetadata(result);
      expect(mockedFetchCover).toHaveBeenCalledWith(
        "https://m.media-amazon.com/images/books/5907.jpg",
      );
      expect(metadata.coverData).toBe(coverBuffer);
      expect(metadata.coverMimeType).toBe("image/jpeg");
    });

    it("falls back to autocomplete image URL", () => {
      const result = makeResult();
      mockedFetchCover.mockReturnValue(new ArrayBuffer(8));

      toMetadata(result);
      expect(mockedFetchCover).toHaveBeenCalledWith(
        "https://i.gr-assets.com/images/books/5907._SY75_.jpg",
      );
    });

    it("handles cover fetch failure gracefully", () => {
      const result = makeResult();
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.coverData).toBeUndefined();
      expect(metadata.coverMimeType).toBeUndefined();
    });
  });

  describe("date parsing", () => {
    it("parses full date with comma", () => {
      const result = makeResult({
        pageData: {
          schemaOrg: null,
          description: null,
          series: null,
          seriesNumber: null,
          genres: [],
          publisher: null,
          publishDate: "September 21, 1937",
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.releaseDate).toBe("1937-09-21T00:00:00Z");
    });

    it("parses month and year only", () => {
      const result = makeResult({
        pageData: {
          schemaOrg: null,
          description: null,
          series: null,
          seriesNumber: null,
          genres: [],
          publisher: null,
          publishDate: "March 2007",
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.releaseDate).toBe("2007-03-01T00:00:00Z");
    });

    it("parses year only", () => {
      const result = makeResult({
        pageData: {
          schemaOrg: null,
          description: null,
          series: null,
          seriesNumber: null,
          genres: [],
          publisher: null,
          publishDate: "1937",
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.releaseDate).toBe("1937-01-01T00:00:00Z");
    });
  });
});
