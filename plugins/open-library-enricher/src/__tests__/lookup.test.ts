import {
  fetchAuthor,
  fetchByISBN,
  fetchEdition,
  fetchWork,
  searchBooks,
} from "../api";
import { findBook } from "../lookup";
import type { OLAuthor, OLEdition, OLSearchResult, OLWork } from "../types";
import type { MetadataEnricherContext } from "@shisho/plugin-types";
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

function makeContext(
  overrides: Partial<MetadataEnricherContext> = {},
): MetadataEnricherContext {
  return {
    parsedMetadata: {},
    file: {},
    book: {},
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

describe("findBook", () => {
  describe("edition ID lookup", () => {
    it("looks up by edition ID from parsedMetadata", () => {
      const context = makeContext({
        parsedMetadata: {
          identifiers: [{ type: "openlibrary_edition", value: "OL123M" }],
        },
      });
      mockedFetchEdition.mockReturnValue(sampleEdition);
      mockedFetchWork.mockReturnValue(sampleWork);
      mockedFetchAuthor.mockReturnValue(sampleAuthor);
      mockedSearchBooks.mockReturnValue(null);

      const result = findBook(context);

      expect(mockedFetchEdition).toHaveBeenCalledWith("OL123M");
      expect(mockedFetchWork).toHaveBeenCalledWith("OL456W");
      expect(result).not.toBeNull();
      expect(result!.edition).toEqual(sampleEdition);
      expect(result!.work).toEqual(sampleWork);
    });

    it("looks up by edition ID from book identifiers", () => {
      const context = makeContext({
        book: {
          identifiers: [{ type: "openlibrary_edition", value: "OL123M" }],
        },
      });
      mockedFetchEdition.mockReturnValue(sampleEdition);
      mockedFetchWork.mockReturnValue(sampleWork);
      mockedFetchAuthor.mockReturnValue(sampleAuthor);
      mockedSearchBooks.mockReturnValue(null);

      const result = findBook(context);
      expect(result).not.toBeNull();
      expect(mockedFetchEdition).toHaveBeenCalledWith("OL123M");
    });
  });

  describe("work ID lookup", () => {
    it("looks up by work ID when no edition ID", () => {
      const context = makeContext({
        parsedMetadata: {
          identifiers: [{ type: "openlibrary_work", value: "OL456W" }],
        },
      });
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

      const result = findBook(context);

      expect(mockedFetchWork).toHaveBeenCalledWith("OL456W");
      expect(result).not.toBeNull();
      expect(result!.work).toEqual(sampleWork);
    });
  });

  describe("ISBN lookup", () => {
    it("looks up by ISBN when no OL IDs present", () => {
      const context = makeContext({
        parsedMetadata: {
          identifiers: [{ type: "isbn_13", value: "9780123456789" }],
        },
      });
      mockedFetchByISBN.mockReturnValue(sampleEdition);
      mockedFetchWork.mockReturnValue(sampleWork);
      mockedFetchAuthor.mockReturnValue(sampleAuthor);

      const result = findBook(context);

      expect(mockedFetchByISBN).toHaveBeenCalledWith("9780123456789");
      expect(result).not.toBeNull();
    });
  });

  describe("title/author search", () => {
    it("searches by title and author", () => {
      const context = makeContext({
        parsedMetadata: {
          title: "The Hobbit",
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
      mockedFetchWork.mockReturnValue(sampleWork);
      mockedFetchAuthor.mockReturnValue(sampleAuthor);
      mockedFetchEdition.mockReturnValue(sampleEdition);

      const result = findBook(context);

      expect(mockedSearchBooks).toHaveBeenCalledWith(
        "The Hobbit",
        "J.R.R. Tolkien",
      );
      expect(result).not.toBeNull();
    });

    it("filters out results with author mismatch", () => {
      const context = makeContext({
        parsedMetadata: {
          title: "The Hobbit",
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

      const result = findBook(context);
      expect(result).toBeNull();
    });

    it("filters out results with high Levenshtein distance", () => {
      const context = makeContext({
        parsedMetadata: {
          title: "The Hobbit",
        },
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

      const result = findBook(context);
      expect(result).toBeNull();
    });
  });

  describe("no match found", () => {
    it("returns null when all strategies fail", () => {
      const context = makeContext({
        parsedMetadata: {
          title: "Unknown Book",
        },
      });
      mockedSearchBooks.mockReturnValue({ numFound: 0, start: 0, docs: [] });

      const result = findBook(context);
      expect(result).toBeNull();
    });

    it("returns null when no title or identifiers available", () => {
      const context = makeContext();

      const result = findBook(context);
      expect(result).toBeNull();
    });
  });

  describe("priority ordering", () => {
    it("tries edition ID before ISBN", () => {
      const context = makeContext({
        parsedMetadata: {
          identifiers: [
            { type: "openlibrary_edition", value: "OL123M" },
            { type: "isbn_13", value: "9780123456789" },
          ],
        },
      });
      mockedFetchEdition.mockReturnValue(sampleEdition);
      mockedFetchWork.mockReturnValue(sampleWork);
      mockedFetchAuthor.mockReturnValue(sampleAuthor);

      findBook(context);

      expect(mockedFetchEdition).toHaveBeenCalledWith("OL123M");
      expect(mockedFetchByISBN).not.toHaveBeenCalled();
    });

    it("falls back to ISBN when edition ID lookup fails", () => {
      const context = makeContext({
        parsedMetadata: {
          identifiers: [
            { type: "openlibrary_edition", value: "OL999M" },
            { type: "isbn_13", value: "9780123456789" },
          ],
        },
      });
      mockedFetchEdition.mockReturnValueOnce(null); // edition lookup fails
      mockedFetchByISBN.mockReturnValue(sampleEdition);
      mockedFetchEdition.mockReturnValue(sampleEdition); // for completeEditionLookup
      mockedFetchWork.mockReturnValue(sampleWork);
      mockedFetchAuthor.mockReturnValue(sampleAuthor);

      findBook(context);

      expect(mockedFetchEdition).toHaveBeenCalledWith("OL999M");
      expect(mockedFetchByISBN).toHaveBeenCalledWith("9780123456789");
    });
  });
});
