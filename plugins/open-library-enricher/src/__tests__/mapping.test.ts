import { fetchCover } from "../api";
import { toMetadata } from "../mapping";
import type { OLLookupResult } from "../types";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  fetchCover: vi.fn(),
}));

const mockedFetchCover = vi.mocked(fetchCover);

function makeResult(overrides: Partial<OLLookupResult> = {}): OLLookupResult {
  return {
    edition: {
      key: "/books/OL123M",
      title: "Test Book",
      ...overrides.edition,
    },
    work: {
      key: "/works/OL456W",
      title: "Test Work",
      ...overrides.work,
    },
    authors: overrides.authors ?? [],
  };
}

describe("toMetadata", () => {
  describe("basic field mapping", () => {
    it("maps all fields from a full result", () => {
      const result = makeResult({
        edition: {
          key: "/books/OL123M",
          title: "The Hobbit",
          subtitle: "Or There and Back Again",
          publishers: ["HarperCollins"],
          publish_date: "1954",
          isbn_13: ["9780261102217"],
          isbn_10: ["0261102214"],
          covers: [12345],
          works: [{ key: "/works/OL456W" }],
          identifiers: { goodreads: ["5907"] },
        },
        work: {
          key: "/works/OL456W",
          title: "The Hobbit",
          description: "A fantasy novel.",
          subjects: ["genre:Fantasy", "Adventure", "series:Middle-earth"],
          authors: [{ author: { key: "/authors/OL789A" } }],
        },
        authors: [{ key: "/authors/OL789A", name: "J.R.R. Tolkien" }],
      });

      const coverBuffer = new ArrayBuffer(8);
      mockedFetchCover.mockReturnValue({
        data: coverBuffer,
        mimeType: "image/jpeg",
      });

      const metadata = toMetadata(result);

      expect(metadata.title).toBe("The Hobbit");
      expect(metadata.subtitle).toBe("Or There and Back Again");
      expect(metadata.authors).toEqual([{ name: "J.R.R. Tolkien" }]);
      expect(metadata.description).toBe("A fantasy novel.");
      expect(metadata.publisher).toBe("HarperCollins");
      expect(metadata.releaseDate).toBe("1954-01-01T00:00:00Z");
      expect(metadata.genres).toEqual(["Fantasy"]);
      expect(metadata.tags).toEqual(["Adventure"]);
      expect(metadata.coverData).toBe(coverBuffer);
      expect(metadata.coverMimeType).toBe("image/jpeg");
    });

    it("handles minimal result without errors", () => {
      const result = makeResult();
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);

      expect(metadata.title).toBe("Test Book");
      expect(metadata.subtitle).toBeUndefined();
      expect(metadata.authors).toBeUndefined();
      expect(metadata.description).toBeUndefined();
      expect(metadata.publisher).toBeUndefined();
      expect(metadata.narrators).toBeUndefined();
    });

    it("derives subtitle from a colon in title when edition subtitle is absent", () => {
      const result = makeResult({
        edition: {
          key: "/books/OL123M",
          title: "Sapiens: A Brief History of Humankind",
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.title).toBe("Sapiens");
      expect(metadata.subtitle).toBe("A Brief History of Humankind");
    });

    it("splits the work title fallback when edition title is empty", () => {
      const result = makeResult({
        edition: {
          key: "/books/OL123M",
          title: "",
        },
        work: {
          key: "/works/OL456W",
          title: "Sapiens: A Brief History of Humankind",
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.title).toBe("Sapiens");
      expect(metadata.subtitle).toBe("A Brief History of Humankind");
    });

    it("keeps the full title when edition subtitle is present", () => {
      const result = makeResult({
        edition: {
          key: "/books/OL123M",
          title: "Sapiens: A Brief History",
          subtitle: "From Animals into Gods",
        },
      });
      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.title).toBe("Sapiens: A Brief History");
      expect(metadata.subtitle).toBe("From Animals into Gods");
    });
  });

  describe("series extraction", () => {
    it("extracts series from edition", () => {
      const result = makeResult({
        edition: {
          key: "/books/OL123M",
          title: "Test",
          series: ["Discworld Book 5"],
        },
      });

      const metadata = toMetadata(result);
      expect(metadata.series).toBe("Discworld Book 5");
      expect(metadata.seriesNumber).toBe(5);
    });

    it("falls back to work series", () => {
      const result = makeResult({
        work: {
          key: "/works/OL456W",
          title: "Test",
          series: ["Wheel of Time Vol. 3"],
        },
      });

      const metadata = toMetadata(result);
      expect(metadata.series).toBe("Wheel of Time Vol. 3");
      expect(metadata.seriesNumber).toBe(3);
    });

    it("extracts series from subjects with series: prefix", () => {
      const result = makeResult({
        work: {
          key: "/works/OL456W",
          title: "Test",
          subjects: ["series:dark tower"],
        },
      });

      const metadata = toMetadata(result);
      expect(metadata.series).toBe("Dark Tower");
    });
  });

  describe("subject parsing", () => {
    it("parses genre: prefix as genres", () => {
      const result = makeResult({
        work: {
          key: "/works/OL456W",
          title: "Test",
          subjects: ["genre:science fiction", "genre:fantasy"],
        },
      });

      const metadata = toMetadata(result);
      expect(metadata.genres).toEqual(["Science Fiction", "Fantasy"]);
    });

    it("parses plain subjects as tags", () => {
      const result = makeResult({
        work: {
          key: "/works/OL456W",
          title: "Test",
          subjects: ["adventure", "dragons"],
        },
      });

      const metadata = toMetadata(result);
      expect(metadata.tags).toEqual(["Adventure", "Dragons"]);
    });

    it("skips series: subjects in tags", () => {
      const result = makeResult({
        work: {
          key: "/works/OL456W",
          title: "Test",
          subjects: ["series:some series", "adventure"],
        },
      });

      const metadata = toMetadata(result);
      expect(metadata.tags).toEqual(["Adventure"]);
    });
  });

  describe("identifier collection", () => {
    it("collects all identifier types", () => {
      const result = makeResult({
        edition: {
          key: "/books/OL123M",
          title: "Test",
          isbn_13: ["9780123456789"],
          isbn_10: ["0123456789"],
          identifiers: { goodreads: ["12345"] },
        },
        work: {
          key: "/works/OL456W",
          title: "Test",
        },
      });

      const metadata = toMetadata(result);
      expect(metadata.identifiers).toEqual([
        { type: "openlibrary_work", value: "OL456W" },
        { type: "openlibrary_edition", value: "OL123M" },
        { type: "isbn_13", value: "9780123456789" },
        { type: "isbn_10", value: "0123456789" },
        { type: "goodreads", value: "12345" },
      ]);
    });

    it("skips edition identifier for synthetic editions with empty key", () => {
      const result = makeResult({
        edition: {
          key: "",
          title: "Test",
        },
        work: {
          key: "/works/OL456W",
          title: "Test",
        },
      });

      const metadata = toMetadata(result);
      expect(metadata.identifiers).toEqual([
        { type: "openlibrary_work", value: "OL456W" },
      ]);
    });
  });

  describe("cover fetching", () => {
    it("fetches cover when coverId is present on edition", () => {
      const result = makeResult({
        edition: {
          key: "/books/OL123M",
          title: "Test",
          covers: [67890],
        },
      });

      const coverBuffer = new ArrayBuffer(16);
      mockedFetchCover.mockReturnValue({
        data: coverBuffer,
        mimeType: "image/png",
      });

      const metadata = toMetadata(result);
      expect(mockedFetchCover).toHaveBeenCalledWith(67890);
      expect(metadata.coverData).toBe(coverBuffer);
      expect(metadata.coverMimeType).toBe("image/png");
    });

    it("falls back to work cover when edition has none", () => {
      const result = makeResult({
        work: {
          key: "/works/OL456W",
          title: "Test",
          covers: [11111],
        },
      });

      mockedFetchCover.mockReturnValue({
        data: new ArrayBuffer(8),
        mimeType: "image/jpeg",
      });

      toMetadata(result);
      expect(mockedFetchCover).toHaveBeenCalledWith(11111);
    });

    it("handles cover fetch failure gracefully", () => {
      const result = makeResult({
        edition: {
          key: "/books/OL123M",
          title: "Test",
          covers: [67890],
        },
      });

      mockedFetchCover.mockReturnValue(null);

      const metadata = toMetadata(result);
      expect(metadata.coverData).toBeUndefined();
      expect(metadata.coverMimeType).toBeUndefined();
    });
  });

  describe("narrator extraction", () => {
    it("extracts narrators from contributors with Narrator role", () => {
      const result = makeResult({
        edition: {
          key: "/books/OL123M",
          title: "Test",
          contributors: [
            { name: "John Smith", role: "Narrator" },
            { name: "Jane Doe", role: "Editor" },
          ],
        },
      });

      const metadata = toMetadata(result);
      expect(metadata.narrators).toEqual(["John Smith"]);
    });

    it("extracts narrators from contributors with Reader role", () => {
      const result = makeResult({
        edition: {
          key: "/books/OL123M",
          title: "Test",
          contributors: [{ name: "John Smith", role: "Reader" }],
        },
      });

      const metadata = toMetadata(result);
      expect(metadata.narrators).toEqual(["John Smith"]);
    });

    it("does not include narrators when none found", () => {
      const result = makeResult({
        edition: {
          key: "/books/OL123M",
          title: "Test",
          contributors: [{ name: "Jane Doe", role: "Editor" }],
        },
      });

      const metadata = toMetadata(result);
      expect(metadata.narrators).toBeUndefined();
    });
  });
});
