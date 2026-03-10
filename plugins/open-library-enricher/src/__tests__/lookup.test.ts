import {
  fetchAuthor,
  fetchByISBN,
  fetchEdition,
  fetchWork,
  searchBooks,
} from "../api";
import { lookupByProviderData, searchForBooks } from "../lookup";
import type {
  OLAuthor,
  OLEdition,
  OLProviderData,
  OLSearchResult,
  OLWork,
} from "../types";
import type { SearchContext } from "@shisho/plugin-types";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  fetchEdition: vi.fn(),
  fetchWork: vi.fn(),
  fetchByISBN: vi.fn(),
  fetchAuthor: vi.fn(),
  searchBooks: vi.fn(),
}));

const mockedFetchEdition = vi.mocked(fetchEdition);
const mockedFetchWork = vi.mocked(fetchWork);
const mockedFetchByISBN = vi.mocked(fetchByISBN);
const mockedFetchAuthor = vi.mocked(fetchAuthor);
const mockedSearchBooks = vi.mocked(searchBooks);

function makeContext(overrides: Partial<SearchContext> = {}): SearchContext {
  return {
    query: "",
    book: {},
    file: {},
    ...overrides,
  };
}

const sampleEdition: OLEdition = {
  key: "/books/OL123M",
  title: "The Hobbit",
  works: [{ key: "/works/OL456W" }],
};

const sampleWork: OLWork = {
  key: "/works/OL456W",
  title: "The Hobbit",
  authors: [{ author: { key: "/authors/OL789A" } }],
};

const sampleAuthor: OLAuthor = {
  key: "/authors/OL789A",
  name: "J.R.R. Tolkien",
};

describe("searchForBooks", () => {
  describe("edition ID lookup", () => {
    it("finds by edition ID from book identifiers", () => {
      const context = makeContext({
        book: {
          identifiers: [{ type: "openlibrary_edition", value: "OL123M" }],
        },
      });
      mockedFetchEdition.mockReturnValue(sampleEdition);
      mockedSearchBooks.mockReturnValue({
        numFound: 1,
        start: 0,
        docs: [
          {
            key: "/works/OL456W",
            title: "The Hobbit",
            author_name: ["J.R.R. Tolkien"],
          },
        ],
      });

      const results = searchForBooks(context);

      expect(mockedFetchEdition).toHaveBeenCalledWith("OL123M");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("The Hobbit");
      expect(results[0].authors).toEqual(["J.R.R. Tolkien"]);
      expect(results[0].providerData).toEqual({
        editionId: "OL123M",
        workId: "OL456W",
      });
      expect(results[0].identifiers).toEqual(
        expect.arrayContaining([
          { type: "openlibrary_work", value: "OL456W" },
          { type: "openlibrary_edition", value: "OL123M" },
        ]),
      );
    });
  });

  describe("work ID lookup", () => {
    it("finds by work ID when no edition ID", () => {
      const context = makeContext({
        book: {
          identifiers: [{ type: "openlibrary_work", value: "OL456W" }],
        },
      });
      mockedFetchWork.mockReturnValue(sampleWork);
      mockedSearchBooks.mockReturnValue({
        numFound: 1,
        start: 0,
        docs: [
          {
            key: "/works/OL456W",
            title: "The Hobbit",
            author_name: ["J.R.R. Tolkien"],
            first_publish_year: 1937,
          },
        ],
      });

      const results = searchForBooks(context);

      expect(mockedFetchWork).toHaveBeenCalledWith("OL456W");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("The Hobbit");
      expect(results[0].authors).toEqual(["J.R.R. Tolkien"]);
      expect(results[0].providerData).toEqual({ workId: "OL456W" });
      expect(results[0].releaseDate).toBe("1937-01-01T00:00:00Z");
      expect(results[0].identifiers).toEqual([
        { type: "openlibrary_work", value: "OL456W" },
      ]);
    });
  });

  describe("ISBN lookup", () => {
    it("finds by ISBN when no OL IDs present", () => {
      const context = makeContext({
        book: {
          identifiers: [{ type: "isbn_13", value: "9780123456789" }],
        },
      });
      mockedFetchByISBN.mockReturnValue(sampleEdition);
      mockedSearchBooks.mockReturnValue({
        numFound: 1,
        start: 0,
        docs: [
          {
            key: "/works/OL456W",
            title: "The Hobbit",
            author_name: ["J.R.R. Tolkien"],
          },
        ],
      });

      const results = searchForBooks(context);

      expect(mockedFetchByISBN).toHaveBeenCalledWith("9780123456789");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("The Hobbit");
      expect(results[0].authors).toEqual(["J.R.R. Tolkien"]);
    });
  });

  describe("title/author search", () => {
    it("searches by query and author", () => {
      const context = makeContext({
        query: "The Hobbit",
        book: {
          authors: [{ name: "J.R.R. Tolkien" }],
        },
      });

      const searchResult: OLSearchResult = {
        numFound: 1,
        start: 0,
        docs: [
          {
            key: "/works/OL456W",
            title: "The Hobbit",
            author_name: ["J.R.R. Tolkien"],
            edition_key: ["OL123M"],
          },
        ],
      };
      mockedSearchBooks.mockReturnValue(searchResult);

      const results = searchForBooks(context);

      expect(mockedSearchBooks).toHaveBeenCalledWith(
        "The Hobbit",
        "J.R.R. Tolkien",
      );
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("The Hobbit");
      expect(results[0].authors).toEqual(["J.R.R. Tolkien"]);
      expect(results[0].identifiers).toEqual([
        { type: "openlibrary_work", value: "OL456W" },
        { type: "openlibrary_edition", value: "OL123M" },
      ]);
    });

    it("falls back to book.title when query is empty", () => {
      const context = makeContext({
        query: "",
        book: {
          title: "The Hobbit",
        },
      });

      const searchResult: OLSearchResult = {
        numFound: 1,
        start: 0,
        docs: [
          {
            key: "/works/OL456W",
            title: "The Hobbit",
          },
        ],
      };
      mockedSearchBooks.mockReturnValue(searchResult);

      const results = searchForBooks(context);

      expect(mockedSearchBooks).toHaveBeenCalledWith("The Hobbit", undefined);
      expect(results).toHaveLength(1);
    });

    it("filters out results with author mismatch", () => {
      const context = makeContext({
        query: "The Hobbit",
        book: {
          authors: [{ name: "J.R.R. Tolkien" }],
        },
      });

      const searchResult: OLSearchResult = {
        numFound: 1,
        start: 0,
        docs: [
          {
            key: "/works/OL999W",
            title: "The Hobbit",
            author_name: ["Wrong Author"],
          },
        ],
      };
      mockedSearchBooks.mockReturnValue(searchResult);

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("filters out results with no author info when context has authors", () => {
      const context = makeContext({
        query: "The Hobbit",
        book: {
          authors: [{ name: "J.R.R. Tolkien" }],
        },
      });

      const searchResult: OLSearchResult = {
        numFound: 1,
        start: 0,
        docs: [
          {
            key: "/works/OL999W",
            title: "The Hobbit",
            // no author_name field
          },
        ],
      };
      mockedSearchBooks.mockReturnValue(searchResult);

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("filters out results with high Levenshtein distance", () => {
      const context = makeContext({
        query: "The Hobbit",
      });

      const searchResult: OLSearchResult = {
        numFound: 1,
        start: 0,
        docs: [
          {
            key: "/works/OL999W",
            title: "A Completely Different Title Altogether",
          },
        ],
      };
      mockedSearchBooks.mockReturnValue(searchResult);

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("filters out short title matches that exceed relative threshold", () => {
      const context = makeContext({
        query: "Dune",
      });

      const searchResult: OLSearchResult = {
        numFound: 1,
        start: 0,
        docs: [
          {
            key: "/works/OL999W",
            title: "Duneland", // distance 4, but ratio 4/8 = 0.5 > 0.4
          },
        ],
      };
      mockedSearchBooks.mockReturnValue(searchResult);

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });
  });

  describe("no match found", () => {
    it("returns empty when all strategies fail", () => {
      const context = makeContext({
        query: "Unknown Book",
      });
      mockedSearchBooks.mockReturnValue({ numFound: 0, start: 0, docs: [] });

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });

    it("returns empty when no query or identifiers available", () => {
      const context = makeContext();

      const results = searchForBooks(context);
      expect(results).toHaveLength(0);
    });
  });

  describe("priority ordering", () => {
    it("tries edition ID before ISBN", () => {
      const context = makeContext({
        book: {
          identifiers: [
            { type: "openlibrary_edition", value: "OL123M" },
            { type: "isbn_13", value: "9780123456789" },
          ],
        },
      });
      mockedFetchEdition.mockReturnValue(sampleEdition);

      searchForBooks(context);

      expect(mockedFetchEdition).toHaveBeenCalledWith("OL123M");
      expect(mockedFetchByISBN).not.toHaveBeenCalled();
    });

    it("falls back to ISBN when edition ID lookup fails", () => {
      const context = makeContext({
        book: {
          identifiers: [
            { type: "openlibrary_edition", value: "OL999M" },
            { type: "isbn_13", value: "9780123456789" },
          ],
        },
      });
      mockedFetchEdition.mockReturnValue(null);
      mockedFetchByISBN.mockReturnValue(sampleEdition);

      searchForBooks(context);

      expect(mockedFetchEdition).toHaveBeenCalledWith("OL999M");
      expect(mockedFetchByISBN).toHaveBeenCalledWith("9780123456789");
    });
  });
});

describe("lookupByProviderData", () => {
  it("looks up by edition ID", () => {
    const providerData: OLProviderData = { editionId: "OL123M" };
    mockedFetchEdition.mockReturnValue(sampleEdition);
    mockedFetchWork.mockReturnValue(sampleWork);
    mockedFetchAuthor.mockReturnValue(sampleAuthor);

    const result = lookupByProviderData(providerData);

    expect(mockedFetchEdition).toHaveBeenCalledWith("OL123M");
    expect(result).not.toBeNull();
    expect(result!.edition).toEqual(sampleEdition);
    expect(result!.work).toEqual(sampleWork);
  });

  it("looks up by work ID when no edition ID", () => {
    const providerData: OLProviderData = { workId: "OL456W" };
    mockedFetchWork.mockReturnValue(sampleWork);
    mockedFetchAuthor.mockReturnValue(sampleAuthor);
    mockedSearchBooks.mockReturnValue({
      numFound: 1,
      start: 0,
      docs: [
        {
          key: "/works/OL456W",
          title: "The Hobbit",
          edition_key: ["OL123M"],
        },
      ],
    });
    mockedFetchEdition.mockReturnValue(sampleEdition);

    const result = lookupByProviderData(providerData);

    expect(mockedFetchWork).toHaveBeenCalledWith("OL456W");
    expect(result).not.toBeNull();
    expect(result!.work).toEqual(sampleWork);
  });

  it("returns null when neither ID resolves", () => {
    const providerData: OLProviderData = { editionId: "OL999M" };
    mockedFetchEdition.mockReturnValue(null);

    const result = lookupByProviderData(providerData);
    expect(result).toBeNull();
  });

  it("falls back to work ID when edition lookup fails", () => {
    const providerData: OLProviderData = {
      editionId: "OL999M",
      workId: "OL456W",
    };
    mockedFetchEdition.mockReturnValueOnce(null); // edition lookup fails
    mockedFetchWork.mockReturnValue(sampleWork);
    mockedFetchAuthor.mockReturnValue(sampleAuthor);
    mockedSearchBooks.mockReturnValue({
      numFound: 1,
      start: 0,
      docs: [
        {
          key: "/works/OL456W",
          title: "The Hobbit",
          edition_key: ["OL123M"],
        },
      ],
    });
    mockedFetchEdition.mockReturnValue(sampleEdition);

    const result = lookupByProviderData(providerData);

    expect(result).not.toBeNull();
    expect(result!.work).toEqual(sampleWork);
  });

  it("returns work-only data when search endpoint fails", () => {
    const providerData: OLProviderData = { workId: "OL456W" };
    mockedFetchWork.mockReturnValue(sampleWork);
    mockedFetchAuthor.mockReturnValue(sampleAuthor);
    mockedSearchBooks.mockReturnValue(null); // search fails

    const result = lookupByProviderData(providerData);

    expect(result).not.toBeNull();
    expect(result!.work).toEqual(sampleWork);
    expect(result!.edition.key).toBe("");
    expect(result!.authors).toEqual([sampleAuthor]);
  });
});
