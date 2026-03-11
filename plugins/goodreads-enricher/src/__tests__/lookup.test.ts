import { fetchBookPage, searchAutocomplete } from "../api";
import { lookupByProviderData, searchForBooks } from "../lookup";
import { parseBookPage } from "../parsing";
import type { GRAutocompleteResult, GRProviderData } from "../types";
import type { SearchContext } from "@shisho/plugin-types";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  searchAutocomplete: vi.fn(),
  fetchBookPage: vi.fn(),
  fetchCover: vi.fn(),
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

describe("searchForBooks", () => {
  describe("Goodreads ID lookup", () => {
    it("finds by Goodreads ID from book identifiers", () => {
      const context = makeContext({
        book: {
          identifiers: [{ type: "goodreads", value: "5907" }],
        },
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("5907");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("The Hobbit, or There and Back Again");
      expect(results[0].authors).toEqual(["J.R.R. Tolkien"]);
      expect(results[0].providerData).toEqual({ bookId: "5907" });
      expect(results[0].identifiers).toEqual([
        { type: "goodreads", value: "5907" },
      ]);
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

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("9780261102217");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("The Hobbit, or There and Back Again");
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
        .mockReturnValueOnce(null) // ISBN-13 fails
        .mockReturnValueOnce([sampleAutocomplete]); // ISBN-10 succeeds

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

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith(
        "The Hobbit J.R.R. Tolkien",
      );
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("The Hobbit");
    });

    it("falls back to book.title when query is empty", () => {
      const context = makeContext({
        query: "",
        book: { title: "The Hobbit" },
      });
      mockedSearchAutocomplete.mockReturnValue([closeTitleAutocomplete]);

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

    it("includes description from autocomplete HTML", () => {
      const context = makeContext({ query: "The Hobbit" });
      mockedSearchAutocomplete.mockReturnValue([closeTitleAutocomplete]);

      const results = searchForBooks(context);
      expect(results[0].description).toBe(
        "In a hole in the ground there lived a hobbit.",
      );
    });

    it("includes image URL from autocomplete", () => {
      const context = makeContext({ query: "The Hobbit" });
      mockedSearchAutocomplete.mockReturnValue([closeTitleAutocomplete]);

      const results = searchForBooks(context);
      expect(results[0].imageUrl).toBe(
        "https://i.gr-assets.com/images/books/5907._SY75_.jpg",
      );
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
      // First call (Goodreads ID) - no matching result
      mockedSearchAutocomplete.mockReturnValueOnce([sampleAutocomplete]);
      // Second call (ISBN) - returns result
      mockedSearchAutocomplete.mockReturnValueOnce([sampleAutocomplete]);

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

describe("lookupByProviderData", () => {
  const defaultPageData = {
    schemaOrg: null,
    description: null,
    series: null,
    seriesNumber: null,
    genres: [],
    publisher: null,
    publishDate: null,
  };

  it("returns combined autocomplete and page data", () => {
    const providerData: GRProviderData = { bookId: "5907" };
    mockedFetchBookPage.mockReturnValue("<html>page</html>");
    mockedParseBookPage.mockReturnValue({
      schemaOrg: { name: "The Hobbit" },
      description: "Full description.",
      series: null,
      seriesNumber: null,
      genres: ["Fantasy"],
      publisher: "HarperCollins",
      publishDate: "September 21, 1937",
    });
    mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);

    const result = lookupByProviderData(providerData);

    expect(result).not.toBeNull();
    expect(result!.bookId).toBe("5907");
    expect(result!.autocomplete).toEqual(sampleAutocomplete);
    expect(result!.pageData.description).toBe("Full description.");
    expect(result!.pageData.genres).toEqual(["Fantasy"]);
  });

  it("succeeds with page data only when autocomplete fails", () => {
    const providerData: GRProviderData = { bookId: "56377548" };
    mockedFetchBookPage.mockReturnValue("<html>page</html>");
    mockedParseBookPage.mockReturnValue({
      ...defaultPageData,
      schemaOrg: { name: "Some Book" },
      description: "A description.",
    });
    mockedSearchAutocomplete.mockReturnValue(null);

    const result = lookupByProviderData(providerData);

    expect(result).not.toBeNull();
    expect(result!.bookId).toBe("56377548");
    expect(result!.autocomplete).toBeUndefined();
    expect(result!.pageData.description).toBe("A description.");
  });

  it("returns null when book page fetch fails", () => {
    const providerData: GRProviderData = { bookId: "5907" };
    mockedFetchBookPage.mockReturnValue(null);

    expect(lookupByProviderData(providerData)).toBeNull();
  });

  it("matches exact bookId in autocomplete results", () => {
    const providerData: GRProviderData = { bookId: "5907" };
    const otherResult: GRAutocompleteResult = {
      ...sampleAutocomplete,
      bookId: "9999",
      title: "Wrong Book",
    };
    mockedFetchBookPage.mockReturnValue("<html></html>");
    mockedParseBookPage.mockReturnValue(defaultPageData);
    mockedSearchAutocomplete.mockReturnValue([otherResult, sampleAutocomplete]);

    const result = lookupByProviderData(providerData);

    expect(result!.autocomplete!.bookId).toBe("5907");
  });

  it("falls back to first autocomplete result if exact match not found", () => {
    const providerData: GRProviderData = { bookId: "5907" };
    const otherResult: GRAutocompleteResult = {
      ...sampleAutocomplete,
      bookId: "9999",
      title: "Close Match",
    };
    mockedFetchBookPage.mockReturnValue("<html></html>");
    mockedParseBookPage.mockReturnValue(defaultPageData);
    mockedSearchAutocomplete.mockReturnValue([otherResult]);

    const result = lookupByProviderData(providerData);

    expect(result!.autocomplete!.bookId).toBe("9999");
  });
});
