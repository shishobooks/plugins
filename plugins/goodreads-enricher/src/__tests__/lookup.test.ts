import { fetchBookPage, searchAutocomplete } from "../api";
import { extractQueryIdentifiers, searchForBooks } from "../lookup";
import { parseBookPage } from "../parsing";
import type { GRAutocompleteResult } from "../types";
import type { SearchContext } from "@shisho/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  searchAutocomplete: vi.fn(),
  fetchBookPage: vi.fn(),
}));

vi.mock("../parsing", () => ({
  parseBookPage: vi.fn(),
}));

const mockedSearchAutocomplete = vi.mocked(searchAutocomplete);
const mockedFetchBookPage = vi.mocked(fetchBookPage);
const mockedParseBookPage = vi.mocked(parseBookPage);

function makeContext(overrides: Partial<SearchContext> = {}): SearchContext {
  return {
    query: "",
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

const samplePageDataWithAsin = {
  ...samplePageData,
  schemaOrg: { ...samplePageData.schemaOrg, asin: "B002OFC2UC" },
};

/** Set up mocks so book page fetch + parse succeeds with sample data. */
function mockBookPageSuccess() {
  mockedFetchBookPage.mockReturnValue("<html>page</html>");
  mockedParseBookPage.mockReturnValue(samplePageData);
}

function mockBookPageSuccessWithAsin() {
  mockedFetchBookPage.mockReturnValue("<html>page</html>");
  mockedParseBookPage.mockReturnValue(samplePageDataWithAsin);
}

describe("searchForBooks", () => {
  describe("Goodreads ID lookup", () => {
    it("finds by Goodreads ID from identifiers via direct book page fetch", () => {
      const context = makeContext({
        identifiers: [{ type: "goodreads", value: "5907" }],
      });
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(mockedFetchBookPage).toHaveBeenCalledWith("5907");
      expect(mockedSearchAutocomplete).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
      expect(results[0].url).toBe("https://www.goodreads.com/book/show/5907");
    });

    it("returns empty when the book page fetch fails", () => {
      const context = makeContext({
        identifiers: [{ type: "goodreads", value: "99999" }],
      });
      mockedFetchBookPage.mockReturnValue(null);

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });
  });

  describe("ISBN lookup", () => {
    it("finds by ISBN with confidence 1.0 when book page ISBN matches", () => {
      const context = makeContext({
        identifiers: [{ type: "isbn_13", value: "9780261102217" }],
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("9780261102217");
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
    });

    it("returns result with confidence 0.9 when book page ISBN does not match", () => {
      const context = makeContext({
        identifiers: [{ type: "isbn_13", value: "9999999999999" }],
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(0.9);
    });

    it("matches when query ISBN-10 equals page ISBN-13", () => {
      // samplePageData has schemaOrg.isbn = "9780261102217"; querying the
      // equivalent ISBN-10 "0261102214" should still verify as confidence 1.0.
      const context = makeContext({
        identifiers: [{ type: "isbn_10", value: "0261102214" }],
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(results[0].confidence).toBe(1.0);
    });

    it("matches when query ISBN has dashes", () => {
      const context = makeContext({
        identifiers: [{ type: "isbn_13", value: "978-0-261-10221-7" }],
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(results[0].confidence).toBe(1.0);
    });

    it("returns confidence 0.9 when book page fetch fails (cannot verify)", () => {
      const context = makeContext({
        identifiers: [{ type: "isbn_13", value: "9780261102217" }],
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockedFetchBookPage.mockReturnValue(null);

      const results = searchForBooks(context);

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(0.9);
    });

    it("tries ISBN-10 if ISBN-13 fails", () => {
      const context = makeContext({
        identifiers: [
          { type: "isbn_13", value: "0000000000000" },
          { type: "isbn_10", value: "0261102214" },
        ],
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

  describe("ASIN lookup", () => {
    it("finds by ASIN with confidence 1.0 when book page ASIN matches", () => {
      const context = makeContext({
        identifiers: [{ type: "asin", value: "B002OFC2UC" }],
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccessWithAsin();

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("B002OFC2UC");
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
      expect(results[0].identifiers).toContainEqual({
        type: "asin",
        value: "B002OFC2UC",
      });
    });

    it("returns confidence 0.9 when book page ASIN does not match", () => {
      const context = makeContext({
        identifiers: [{ type: "asin", value: "BXXXXXXXXX" }],
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccessWithAsin();

      const results = searchForBooks(context);

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(0.9);
    });

    it("is case-insensitive", () => {
      const context = makeContext({
        identifiers: [{ type: "asin", value: "b002ofc2uc" }],
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccessWithAsin();

      const results = searchForBooks(context);

      expect(results[0].confidence).toBe(1.0);
    });

    it("runs after ISBN lookup has failed", () => {
      const context = makeContext({
        identifiers: [
          { type: "isbn_13", value: "0000000000000" },
          { type: "asin", value: "B002OFC2UC" },
        ],
      });
      mockedSearchAutocomplete
        .mockReturnValueOnce(null) // ISBN miss
        .mockReturnValueOnce([sampleAutocomplete]); // ASIN hit
      mockBookPageSuccessWithAsin();

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenNthCalledWith(
        1,
        "0000000000000",
      );
      expect(mockedSearchAutocomplete).toHaveBeenNthCalledWith(2, "B002OFC2UC");
      expect(results[0].confidence).toBe(1.0);
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
        author: "J.R.R. Tolkien",
      });
      mockedSearchAutocomplete.mockReturnValue([closeTitleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith(
        "The Hobbit J.R.R. Tolkien",
      );
      expect(results).toHaveLength(1);
    });

    it("returns empty when query is empty", () => {
      const context = makeContext({ query: "" });

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("filters out results with author mismatch", () => {
      const context = makeContext({
        query: "The Hobbit",
        author: "Wrong Author",
      });
      mockedSearchAutocomplete.mockReturnValue([closeTitleAutocomplete]);

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("keeps loosely-matching results with low confidence", () => {
      const context = makeContext({
        query: "The Hobbit",
      });
      const differentTitle: GRAutocompleteResult = {
        ...sampleAutocomplete,
        bookTitleBare: "A Completely Different Title Altogether",
      };
      mockedSearchAutocomplete.mockReturnValue([differentTitle]);
      mockBookPageSuccess();

      const results = searchForBooks(context);
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBeLessThan(0.5);
    });

    it("gives high confidence when query matches title ignoring subtitle", () => {
      const context = makeContext({ query: "The Hobbit" });
      const withSubtitle: GRAutocompleteResult = {
        ...sampleAutocomplete,
        bookTitleBare: "The Hobbit: The Unexpected Journey Companion",
      };
      mockedSearchAutocomplete.mockReturnValue([withSubtitle]);
      mockBookPageSuccess();

      const results = searchForBooks(context);
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
    });

    it("computes confidence from Levenshtein distance", () => {
      const context = makeContext({ query: "The Hobbit" });
      mockedSearchAutocomplete.mockReturnValue([closeTitleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);
      expect(results[0].confidence).toBe(1.0);
    });
  });

  describe("enriched search results", () => {
    it("populates all fields from book page data", () => {
      const context = makeContext({
        identifiers: [{ type: "goodreads", value: "5907" }],
      });
      mockBookPageSuccess();

      const results = searchForBooks(context);
      const result = results[0];

      expect(result.title).toBe("The Hobbit");
      expect(result.authors).toEqual([{ name: "J.R.R. Tolkien" }]);
      expect(result.description).toBe(
        "A fantasy novel about a hobbit's adventure.",
      );
      expect(result.publisher).toBe("HarperCollins");
      expect(result.releaseDate).toBe("1937-09-21T00:00:00Z");
      expect(result.series).toBe("Middle-earth");
      expect(result.seriesNumber).toBe(1);
      expect(result.genres).toEqual(["Fantasy", "Classics", "Fiction"]);
      expect(result.tags).toEqual(["Adventure"]);
      expect(result.coverUrl).toBe(
        "https://m.media-amazon.com/images/books/5907.jpg",
      );
      expect(result.url).toBe("https://www.goodreads.com/book/show/5907");
      expect(result.identifiers).toEqual([
        { type: "goodreads", value: "5907" },
        { type: "isbn_13", value: "9780261102217" },
      ]);
    });

    it("falls back to autocomplete-only when book page fails on ISBN lookup", () => {
      const context = makeContext({
        identifiers: [{ type: "isbn_13", value: "9780261102217" }],
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockedFetchBookPage.mockReturnValue(null);

      const results = searchForBooks(context);
      const result = results[0];

      expect(result.title).toBe("The Hobbit, or There and Back Again");
      expect(result.authors).toEqual([{ name: "J.R.R. Tolkien" }]);
      expect(result.description).toBe(
        "In a hole in the ground there lived a hobbit.",
      );
      expect(result.url).toBe("https://www.goodreads.com/book/show/5907");
      expect(result.coverUrl).toBe(
        "https://i.gr-assets.com/images/books/5907.jpg",
      );
      expect(result.series).toBeUndefined();
      expect(result.publisher).toBeUndefined();
    });

    it("uses bookTitleBare and strips series suffix in autocomplete fallback", () => {
      const context = makeContext({
        identifiers: [{ type: "isbn_13", value: "9780756404741" }],
      });
      const seriesAutocomplete: GRAutocompleteResult = {
        ...sampleAutocomplete,
        bookId: "186074",
        title: "The Name of the Wind (The Kingkiller Chronicle, #1)",
        bookTitleBare: "The Name of the Wind (The Kingkiller Chronicle, #1)",
      };
      mockedSearchAutocomplete.mockReturnValue([seriesAutocomplete]);
      mockedFetchBookPage.mockReturnValue(null);

      const results = searchForBooks(context);
      expect(results[0].title).toBe("The Name of the Wind");
    });
  });

  describe("priority ordering", () => {
    it("tries Goodreads ID before ISBN", () => {
      const context = makeContext({
        identifiers: [
          { type: "goodreads", value: "5907" },
          { type: "isbn_13", value: "9780261102217" },
        ],
      });
      mockBookPageSuccess();

      searchForBooks(context);

      expect(mockedFetchBookPage).toHaveBeenCalledTimes(1);
      expect(mockedFetchBookPage).toHaveBeenCalledWith("5907");
      expect(mockedSearchAutocomplete).not.toHaveBeenCalled();
    });

    it("falls back to ISBN when Goodreads ID lookup fails", () => {
      const context = makeContext({
        identifiers: [
          { type: "goodreads", value: "99999" },
          { type: "isbn_13", value: "9780261102217" },
        ],
      });
      // First call: Goodreads ID page fetch fails.
      // Second call: ISBN enrichment fetch succeeds.
      mockedFetchBookPage
        .mockReturnValueOnce(null)
        .mockReturnValueOnce("<html>page</html>");
      mockedParseBookPage.mockReturnValue(samplePageData);
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);

      searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("9780261102217");
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

  describe("query-embedded identifiers", () => {
    it("uses a Goodreads URL pasted into the title field", () => {
      const context = makeContext({
        query: "https://www.goodreads.com/book/show/5907-the-hobbit",
      });
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(mockedFetchBookPage).toHaveBeenCalledWith("5907");
      expect(mockedSearchAutocomplete).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
    });

    it("uses a bare Goodreads ID pasted into the title field", () => {
      const context = makeContext({ query: "5907" });
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(mockedFetchBookPage).toHaveBeenCalledWith("5907");
      expect(results).toHaveLength(1);
    });

    it("uses an ISBN-13 pasted into the title field", () => {
      const context = makeContext({ query: "9780261102217" });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccess();

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("9780261102217");
      expect(results).toHaveLength(1);
    });

    it("accepts an ISBN-13 with hyphens", () => {
      const context = makeContext({ query: "978-0-261-10221-7" });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccess();

      searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("9780261102217");
    });

    it("query-embedded ID overrides file-metadata identifiers", () => {
      const context = makeContext({
        query: "https://www.goodreads.com/book/show/5907",
        identifiers: [
          { type: "goodreads", value: "99999" },
          { type: "isbn_13", value: "9999999999999" },
        ],
      });
      mockBookPageSuccess();

      searchForBooks(context);

      expect(mockedFetchBookPage).toHaveBeenCalledWith("5907");
      expect(mockedFetchBookPage).not.toHaveBeenCalledWith("99999");
    });

    it("query-embedded ISBN beats a file-metadata Goodreads ID", () => {
      // The previous logic only compared query-GR-ID against file-GR-ID;
      // a cross-type mismatch (query ISBN vs file GR ID) still let the
      // file's GR ID win. Ensure that's fixed.
      const context = makeContext({
        query: "9780261102217",
        identifiers: [{ type: "goodreads", value: "99999" }],
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccess();

      searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("9780261102217");
      expect(mockedFetchBookPage).not.toHaveBeenCalledWith("99999");
    });

    it("query-embedded ASIN beats both file-metadata GR ID and ISBN", () => {
      const context = makeContext({
        query: "B002OFC2UC",
        identifiers: [
          { type: "goodreads", value: "99999" },
          { type: "isbn_13", value: "9999999999999" },
        ],
      });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccessWithAsin();

      searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledTimes(1);
      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("B002OFC2UC");
      expect(mockedFetchBookPage).not.toHaveBeenCalledWith("99999");
    });

    it("does not fall back to file identifiers when query identifier misses", () => {
      // Query has a GR URL, but its book page fetch fails. We should
      // return empty — not quietly fall back to the file's identifiers.
      const context = makeContext({
        query: "https://www.goodreads.com/book/show/5907",
        identifiers: [{ type: "isbn_13", value: "9780261102217" }],
      });
      mockedFetchBookPage.mockReturnValue(null);

      const results = searchForBooks(context);

      expect(results).toHaveLength(0);
      expect(mockedSearchAutocomplete).not.toHaveBeenCalled();
    });

    it("does not fall back to title search when query is a bare identifier", () => {
      const context = makeContext({ query: "9780261102217" });
      mockedSearchAutocomplete.mockReturnValue(null);

      const results = searchForBooks(context);

      expect(results).toHaveLength(0);
      // ISBN attempt only — no fuzzy title search on the raw ISBN string.
      expect(mockedSearchAutocomplete).toHaveBeenCalledTimes(1);
    });

    it("uses an ASIN pasted into the title field", () => {
      const context = makeContext({ query: "B002OFC2UC" });
      mockedSearchAutocomplete.mockReturnValue([sampleAutocomplete]);
      mockBookPageSuccessWithAsin();

      const results = searchForBooks(context);

      expect(mockedSearchAutocomplete).toHaveBeenCalledWith("B002OFC2UC");
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
    });

    it("does not fall back to title search when query is an ASIN", () => {
      const context = makeContext({ query: "B002OFC2UC" });
      mockedSearchAutocomplete.mockReturnValue(null);

      const results = searchForBooks(context);

      expect(results).toHaveLength(0);
      expect(mockedSearchAutocomplete).toHaveBeenCalledTimes(1);
    });
  });
});

describe("extractQueryIdentifiers", () => {
  it("extracts a Goodreads ID from a full URL", () => {
    expect(
      extractQueryIdentifiers("https://www.goodreads.com/book/show/5907"),
    ).toEqual({ goodreadsId: "5907" });
  });

  it("extracts a Goodreads ID from a URL with a slug", () => {
    expect(
      extractQueryIdentifiers(
        "https://www.goodreads.com/book/show/5907-the-hobbit",
      ),
    ).toEqual({ goodreadsId: "5907" });
  });

  it("extracts a Goodreads ID from a URL without scheme", () => {
    expect(extractQueryIdentifiers("goodreads.com/book/show/5907")).toEqual({
      goodreadsId: "5907",
    });
  });

  it("treats a bare numeric query as a Goodreads ID", () => {
    expect(extractQueryIdentifiers("5907")).toEqual({ goodreadsId: "5907" });
  });

  it("treats a 13-digit number as ISBN-13", () => {
    expect(extractQueryIdentifiers("9780261102217")).toEqual({
      isbn: "9780261102217",
    });
  });

  it("treats a 10-digit number as ISBN-10", () => {
    expect(extractQueryIdentifiers("0261102214")).toEqual({
      isbn: "0261102214",
    });
  });

  it("treats a 10-char ISBN with X checksum as ISBN-10", () => {
    expect(extractQueryIdentifiers("043942089X")).toEqual({
      isbn: "043942089X",
    });
  });

  it("strips hyphens and spaces from ISBNs", () => {
    expect(extractQueryIdentifiers("978-0-261-10221-7")).toEqual({
      isbn: "9780261102217",
    });
    expect(extractQueryIdentifiers("0-261-10221-4")).toEqual({
      isbn: "0261102214",
    });
  });

  it("extracts a Kindle ASIN", () => {
    expect(extractQueryIdentifiers("B002OFC2UC")).toEqual({
      asin: "B002OFC2UC",
    });
  });

  it("uppercases ASINs typed in lowercase", () => {
    expect(extractQueryIdentifiers("b002ofc2uc")).toEqual({
      asin: "B002OFC2UC",
    });
  });

  it("does not classify a 10-digit all-numeric string as an ASIN", () => {
    expect(extractQueryIdentifiers("0261102214")).toEqual({
      isbn: "0261102214",
    });
  });

  it("returns empty for a plain title", () => {
    expect(extractQueryIdentifiers("The Hobbit")).toEqual({});
  });

  it("returns empty for an empty string", () => {
    expect(extractQueryIdentifiers("")).toEqual({});
    expect(extractQueryIdentifiers("   ")).toEqual({});
  });
});
