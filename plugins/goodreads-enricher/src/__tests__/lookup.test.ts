import { fetchBookPage, searchAutocomplete } from "../api";
import { searchForBooks } from "../lookup";
import { parseBookPage } from "../parsing";
import type { GRAutocompleteResult } from "../types";
import type { SearchContext } from "@shisho/plugin-types";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  searchAutocomplete: vi.fn(),
  fetchBookPage: vi.fn(),
}));

vi.mock("../parsing", () => ({
  parseBookPage: vi.fn(),
  stripHTML: vi.fn((html: string) => html.replace(/<[^>]+>/g, "").trim()),
}));

const mockedSearchAutocomplete = vi.mocked(searchAutocomplete);
const mockedFetchBookPage = vi.mocked(fetchBookPage);
const mockedParseBookPage = vi.mocked(parseBookPage);

function makeContext(overrides: Partial<SearchContext> = {}): SearchContext {
  return {
    query: "",
    book: {},
    file: {},
    ...overrides,
  };
}

const sampleAutocomplete: GRAutocompleteResult = {
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

const samplePageData = {
  schemaOrg: {
    name: "The Hobbit",
    image: "https://m.media-amazon.com/images/books/5907.jpg",
    author: [{ name: "J.R.R. Tolkien", url: "/author/656983" }],
    isbn: "9780261102217",
  },
  description: "A fantasy novel about a hobbit's adventure.",
  series: "Middle-earth",
  seriesNumber: 1,
  genres: ["Fantasy", "Classics", "Fiction", "Adventure"],
  publisher: "HarperCollins",
  publishDate: "September 21, 1937",
};

/** Set up mocks so book page fetch + parse succeeds with sample data. */
function mockBookPageSuccess() {
  mockedFetchBookPage.mockReturnValue("<html>page</html>");
  mockedParseBookPage.mockReturnValue(samplePageData);
}

describe("searchForBooks", () => {
  describe("Goodreads ID lookup", () => {
    it("finds by Goodreads ID from book identifiers", () => {
      const context = makeContext({
        book: {
          identifiers: [{ type: "goodreads", value: "5907" }],
        },
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("5907");
      expect(results).toHaveLength(1);
      expect(results[0].providerData).toEqual({ bookId: "5907" });
    });

    it("returns empty when Goodreads ID not found in results", () => {
      const context = makeContext({
        book: {
          identifiers: [{ type: "goodreads", value: "99999" }],
        },
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });
  });

  describe("ISBN lookup", () => {
    it("finds by ISBN when no Goodreads ID", () => {
      const context = makeContext({
        book: {
          identifiers: [{ type: "isbn_13", value: "9780261102217" }],
        },
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("9780261102217");
      expect(results).toHaveLength(1);
    });

    it("tries ISBN-10 if ISBN-13 fails", () => {
      const context = makeContext({
        book: {
          identifiers: [
            { type: "isbn_13", value: "0000000000000" },
            { type: "isbn_10", value: "0261102214" },
          ],
        },
      });
      mockedSearchAutocomplete
        .mockReturnValueOnce(null)
        .mockReturnValueOnce([sampleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(1);
    });
  });

  describe("title/author search", () => {
    const closeTitleAutocomplete: GRAutocompleteResult = {
      ...sampleAutocomplete,
      bookTitleBare: "The Hobbit",
    };

    it("searches by query and author", () => {
      const context = makeContext({
        query: "The Hobbit",
        book: {
          authors: [{ name: "J.R.R. Tolkien" }],
        },
      });
      mockedSearchAutocomplete.mockReturnValue([closeTitleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith(
        "The Hobbit J.R.R. Tolkien",
      );
      expect(results).toHaveLength(1);
    });

    it("falls back to book.title when query is empty", () => {
      const context = makeContext({
        query: "",
        book: { title: "The Hobbit" },
      });
      mockedSearchAutocomplete.mockReturnValue([closeTitleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("The Hobbit");
      expect(results).toHaveLength(1);
    });

    it("filters out results with author mismatch", () => {
      const context = makeContext({
        query: "The Hobbit",
        book: {
          authors: [{ name: "Wrong Author" }],
        },
      });
      mockedSearchAutocomplete.mockReturnValue([closeTitleAutocomplete]);

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("filters out results with high Levenshtein distance", () => {
      const context = makeContext({
        query: "The Hobbit",
      });
      const differentTitle: GRAutocompleteResult = {
        ...sampleAutocomplete,
        bookTitleBare: "A Completely Different Title Altogether",
      };
      mockedSearchAutocomplete.mockReturnValue([differentTitle]);

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });
  });

  describe("enriched search results", () => {
    it("populates all fields from book page data", () => {
      const context = makeContext({
        book: {
          identifiers: [{ type: "goodreads", value: "5907" }],
        },
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);
      const result = results[0];

      expect(result.title).toBe("The Hobbit, or There and Back Again");
      expect(result.authors).toEqual(["J.R.R. Tolkien"]);
      expect(result.description).toBe(
        "A fantasy novel about a hobbit's adventure.",
      );
      expect(result.publisher).toBe("HarperCollins");
      expect(result.releaseDate).toBe("1937-09-21T00:00:00Z");
      expect(result.series).toBe("Middle-earth");
      expect(result.seriesNumber).toBe(1);
      expect(result.genres).toEqual(["Fantasy", "Classics", "Fiction"]);
      expect(result.tags).toEqual(["Adventure"]);
      expect(result.imageUrl).toBe(
        "https://m.media-amazon.com/images/books/5907.jpg",
      );
      expect(result.identifiers).toEqual([
        { type: "goodreads", value: "5907" },
        { type: "isbn_13", value: "9780261102217" },
      ]);
    });

    it("includes metadata passthrough for enrich phase", () => {
      const context = makeContext({
        book: {
          identifiers: [{ type: "goodreads", value: "5907" }],
        },
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);
      expect(results[0].metadata).toBeDefined();
      expect(results[0].metadata!.title).toBe(
        "The Hobbit, or There and Back Again",
      );
    });

    it("falls back to autocomplete-only when book page fails", () => {
      const context = makeContext({
        book: {
          identifiers: [{ type: "goodreads", value: "5907" }],
        },
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockedFetchBookPage.mockReturnValue(null);

      const results = searchForBooks(context);
      const result = results[0];

      expect(result.title).toBe("The Hobbit, or There and Back Again");
      expect(result.authors).toEqual(["J.R.R. Tolkien"]);
      expect(result.description).toBe(
        "In a hole in the ground there lived a hobbit.",
      );
      // No rich metadata when page fetch fails
      expect(result.metadata).toBeUndefined();
      expect(result.series).toBeUndefined();
      expect(result.publisher).toBeUndefined();
    });
  });

  describe("priority ordering", () => {
    it("tries Goodreads ID before ISBN", () => {
      const context = makeContext({
        book: {
          identifiers: [
            { type: "goodreads", value: "5907" },
            { type: "isbn_13", value: "9780261102217" },
          ],
        },
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccess();

      searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledTimes(1);
      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("5907");
    });

    it("falls back to ISBN when Goodreads ID lookup fails", () => {
      const context = makeContext({
        book: {
          identifiers: [
            { type: "goodreads", value: "99999" },
            { type: "isbn_13", value: "9780261102217" },
          ],
        },
      });
      mockedSearchAutocomplete.mockReturnValueOnce([sampleAutocomplete]);
      mockedSearchAutocomplete.mockReturnValueOnce([sampleAutocomplete]);
      mockBookPageSuccess();

      searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledTimes(2);
    });
  });

  describe("no match found", () => {
    it("returns empty when all strategies fail", () => {
      const context = makeContext({ query: "Unknown Book" });
      mockedSearchAutocomplete.mockReturnValue([]);

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("returns empty when no query or identifiers available", () => {
      const context = makeContext();

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("returns empty when autocomplete returns null", () => {
      const context = makeContext({ query: "The Hobbit" });
      mockedSearchAutocomplete.mockReturnValue(null);

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });
  });
});
