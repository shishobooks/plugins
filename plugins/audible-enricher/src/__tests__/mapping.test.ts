import {
  audibleToMetadata,
  audnexusToMetadata,
  parseAbridged,
  parseLanguage,
  stripHTML,
} from "../mapping";
import type { AudibleProduct, AudnexusBook } from "../types";
import { describe, expect, it } from "vitest";

function makeAudibleProduct(
  overrides: Partial<AudibleProduct> = {},
): AudibleProduct {
  return {
    asin: "B08G9PRS1K",
    title: "Project Hail Mary",
    ...overrides,
  };
}

function makeAudnexusBook(overrides: Partial<AudnexusBook> = {}): AudnexusBook {
  return {
    asin: "B08G9PRS1K",
    title: "Project Hail Mary",
    authors: [{ name: "Andy Weir" }],
    narrators: [{ name: "Ray Porter" }],
    ...overrides,
  };
}

describe("audibleToMetadata", () => {
  it("maps all fields from a full product", () => {
    const product = makeAudibleProduct({
      subtitle: "A Novel",
      authors: [{ name: "Andy Weir" }],
      narrators: [{ name: "Ray Porter" }],
      publisher_name: "Audible Studios",
      publisher_summary: "<p>Ryland Grace is the sole survivor.</p>",
      release_date: "2021-05-04",
      series: [{ title: "Hail Mary", sequence: "1" }],
      product_images: {
        "500": "https://m.media-amazon.com/images/I/500.jpg",
        "1024": "https://m.media-amazon.com/images/I/1024.jpg",
      },
      category_ladders: [
        {
          ladder: [
            { id: "1", name: "Science Fiction & Fantasy" },
            { id: "2", name: "Science Fiction" },
          ],
          root: "Genres",
        },
      ],
    });

    const metadata = audibleToMetadata(product, "us");

    expect(metadata.title).toBe("Project Hail Mary");
    expect(metadata.subtitle).toBe("A Novel");
    expect(metadata.authors).toEqual([{ name: "Andy Weir" }]);
    expect(metadata.narrators).toEqual(["Ray Porter"]);
    expect(metadata.publisher).toBe("Audible Studios");
    expect(metadata.description).toBe("Ryland Grace is the sole survivor.");
    expect(metadata.releaseDate).toBe("2021-05-04T00:00:00Z");
    expect(metadata.series).toBe("Hail Mary");
    expect(metadata.seriesNumber).toBe(1);
    expect(metadata.coverUrl).toBe(
      "https://m.media-amazon.com/images/I/1024.jpg",
    );
    expect(metadata.genres).toEqual(["Science Fiction"]);
    expect(metadata.url).toBe("https://www.audible.com/pd/B08G9PRS1K");
    expect(metadata.identifiers).toEqual([
      { type: "asin", value: "B08G9PRS1K" },
    ]);
  });

  it("handles minimal product", () => {
    const product = makeAudibleProduct();
    const metadata = audibleToMetadata(product, "us");

    expect(metadata.title).toBe("Project Hail Mary");
    expect(metadata.identifiers).toEqual([
      { type: "asin", value: "B08G9PRS1K" },
    ]);
    expect(metadata.subtitle).toBeUndefined();
    expect(metadata.authors).toBeUndefined();
    expect(metadata.narrators).toBeUndefined();
  });

  it("prefers 1024 image over 500", () => {
    const product = makeAudibleProduct({
      product_images: {
        "500": "https://m.media-amazon.com/images/I/500.jpg",
        "1024": "https://m.media-amazon.com/images/I/1024.jpg",
      },
    });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.coverUrl).toBe(
      "https://m.media-amazon.com/images/I/1024.jpg",
    );
  });

  it("falls back to 500 image when 1024 is missing", () => {
    const product = makeAudibleProduct({
      product_images: {
        "500": "https://m.media-amazon.com/images/I/500.jpg",
      },
    });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.coverUrl).toBe(
      "https://m.media-amazon.com/images/I/500.jpg",
    );
  });

  it("extracts leaf genres from category_ladders", () => {
    const product = makeAudibleProduct({
      category_ladders: [
        {
          ladder: [
            { id: "1", name: "Science Fiction & Fantasy" },
            { id: "2", name: "Science Fiction" },
          ],
          root: "Genres",
        },
        {
          ladder: [
            { id: "3", name: "Literature & Fiction" },
            { id: "4", name: "Humor" },
          ],
          root: "Genres",
        },
      ],
    });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.genres).toEqual(["Science Fiction", "Humor"]);
  });

  it("parses fractional series number", () => {
    const product = makeAudibleProduct({
      series: [{ title: "Discworld", sequence: "2.5" }],
    });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.seriesNumber).toBe(2.5);
  });

  it("handles missing series sequence", () => {
    const product = makeAudibleProduct({
      series: [{ title: "Discworld" }],
    });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.series).toBe("Discworld");
    expect(metadata.seriesNumber).toBeUndefined();
  });

  it("constructs URL with correct TLD for non-US marketplace", () => {
    const product = makeAudibleProduct();
    const metadata = audibleToMetadata(product, "uk");
    expect(metadata.url).toBe("https://www.audible.co.uk/pd/B08G9PRS1K");
  });

  it("parses ISO date format", () => {
    const product = makeAudibleProduct({ release_date: "2021-05-04" });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.releaseDate).toBe("2021-05-04T00:00:00Z");
  });

  it("falls back to issue_date when release_date is missing", () => {
    const product = makeAudibleProduct({
      release_date: undefined,
      issue_date: "2021-05-04",
    });
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.releaseDate).toBe("2021-05-04T00:00:00Z");
  });
});

describe("audnexusToMetadata", () => {
  it("maps all fields from a full response", () => {
    const book = makeAudnexusBook({
      subtitle: "A Novel",
      publisherName: "Audible Studios",
      summary: "<p>Ryland Grace is the sole survivor.</p>",
      releaseDate: "2021-05-04",
      image: "https://m.media-amazon.com/images/I/cover.jpg",
      seriesPrimary: { name: "Hail Mary", position: "1" },
      genres: [
        { asin: "1", name: "Science Fiction", type: "genre" },
        { asin: "2", name: "Space Opera", type: "tag" },
        { asin: "3", name: "First Contact", type: "tag" },
      ],
    });

    const metadata = audnexusToMetadata(book, "us");

    expect(metadata.title).toBe("Project Hail Mary");
    expect(metadata.subtitle).toBe("A Novel");
    expect(metadata.authors).toEqual([{ name: "Andy Weir" }]);
    expect(metadata.narrators).toEqual(["Ray Porter"]);
    expect(metadata.publisher).toBe("Audible Studios");
    expect(metadata.description).toBe("Ryland Grace is the sole survivor.");
    expect(metadata.releaseDate).toBe("2021-05-04T00:00:00Z");
    expect(metadata.series).toBe("Hail Mary");
    expect(metadata.seriesNumber).toBe(1);
    expect(metadata.coverUrl).toBe(
      "https://m.media-amazon.com/images/I/cover.jpg",
    );
    expect(metadata.genres).toEqual(["Science Fiction"]);
    expect(metadata.tags).toEqual(["Space Opera", "First Contact"]);
    expect(metadata.url).toBe("https://www.audible.com/pd/B08G9PRS1K");
    expect(metadata.identifiers).toEqual([
      { type: "asin", value: "B08G9PRS1K" },
    ]);
  });

  it("handles minimal response", () => {
    const book = makeAudnexusBook();
    const metadata = audnexusToMetadata(book, "us");

    expect(metadata.title).toBe("Project Hail Mary");
    expect(metadata.authors).toEqual([{ name: "Andy Weir" }]);
    expect(metadata.narrators).toEqual(["Ray Porter"]);
    expect(metadata.genres).toBeUndefined();
    expect(metadata.tags).toBeUndefined();
  });

  it("includes ISBN-13 in identifiers when present", () => {
    const book = makeAudnexusBook({ isbn: "9781603935470" });
    const metadata = audnexusToMetadata(book, "us");
    expect(metadata.identifiers).toEqual([
      { type: "asin", value: "B08G9PRS1K" },
      { type: "isbn_13", value: "9781603935470" },
    ]);
  });

  it("includes ISBN-10 in identifiers when present", () => {
    const book = makeAudnexusBook({ isbn: "0739322214" });
    const metadata = audnexusToMetadata(book, "us");
    expect(metadata.identifiers).toEqual([
      { type: "asin", value: "B08G9PRS1K" },
      { type: "isbn_10", value: "0739322214" },
    ]);
  });

  it("separates genres and tags by type field", () => {
    const book = makeAudnexusBook({
      genres: [
        { asin: "1", name: "Fantasy", type: "genre" },
        { asin: "2", name: "Epic", type: "tag" },
        { asin: "3", name: "Adventure", type: "genre" },
      ],
    });
    const metadata = audnexusToMetadata(book, "us");
    expect(metadata.genres).toEqual(["Fantasy", "Adventure"]);
    expect(metadata.tags).toEqual(["Epic"]);
  });

  it("parses fractional series position", () => {
    const book = makeAudnexusBook({
      seriesPrimary: { name: "Discworld", position: "2.5" },
    });
    const metadata = audnexusToMetadata(book, "us");
    expect(metadata.seriesNumber).toBe(2.5);
  });

  it("handles series with no position", () => {
    const book = makeAudnexusBook({
      seriesPrimary: { name: "Standalone" },
    });
    const metadata = audnexusToMetadata(book, "us");
    expect(metadata.series).toBe("Standalone");
    expect(metadata.seriesNumber).toBeUndefined();
  });
});

describe("stripHTML", () => {
  it("removes HTML tags", () => {
    expect(stripHTML("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("decodes HTML entities", () => {
    expect(stripHTML("one &amp; two")).toBe("one & two");
  });

  it("handles empty string", () => {
    expect(stripHTML("")).toBe("");
  });

  it("handles plain text", () => {
    expect(stripHTML("no tags here")).toBe("no tags here");
  });
});

describe("parseLanguage", () => {
  it("maps english to en", () => {
    expect(parseLanguage("english")).toBe("en");
  });

  it("maps german to de", () => {
    expect(parseLanguage("german")).toBe("de");
  });

  it("is case-insensitive", () => {
    expect(parseLanguage("English")).toBe("en");
    expect(parseLanguage("FRENCH")).toBe("fr");
  });

  it("passes through BCP 47 tags", () => {
    expect(parseLanguage("en")).toBe("en");
    expect(parseLanguage("en-US")).toBe("en-US");
    expect(parseLanguage("zh-Hans")).toBe("zh-Hans");
  });

  it("returns undefined for unknown language", () => {
    expect(parseLanguage("klingon")).toBeUndefined();
  });

  it("returns undefined for empty or missing", () => {
    expect(parseLanguage(undefined)).toBeUndefined();
    expect(parseLanguage("")).toBeUndefined();
    expect(parseLanguage("   ")).toBeUndefined();
  });
});

describe("parseAbridged", () => {
  it("maps unabridged to false", () => {
    expect(parseAbridged("unabridged")).toBe(false);
  });

  it("maps abridged to true", () => {
    expect(parseAbridged("abridged")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(parseAbridged("Unabridged")).toBe(false);
    expect(parseAbridged("ABRIDGED")).toBe(true);
  });

  it("returns undefined for unknown value", () => {
    expect(parseAbridged("something")).toBeUndefined();
  });

  it("returns undefined for missing value", () => {
    expect(parseAbridged(undefined)).toBeUndefined();
    expect(parseAbridged("")).toBeUndefined();
  });
});

describe("language and abridged in audibleToMetadata", () => {
  it("maps language and format_type", () => {
    const product: AudibleProduct = {
      asin: "B08G9PRS1K",
      title: "Project Hail Mary",
      language: "english",
      format_type: "unabridged",
    };
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.language).toBe("en");
    expect(metadata.abridged).toBe(false);
  });

  it("omits language when unknown", () => {
    const product: AudibleProduct = {
      asin: "B08G9PRS1K",
      title: "Test",
      language: "klingon",
    };
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.language).toBeUndefined();
  });

  it("omits abridged when format_type is missing", () => {
    const product: AudibleProduct = {
      asin: "B08G9PRS1K",
      title: "Test",
    };
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.abridged).toBeUndefined();
  });

  it("maps abridged=true when format_type is 'abridged'", () => {
    const product: AudibleProduct = {
      asin: "B08G9PRS1K",
      title: "Test",
      format_type: "abridged",
    };
    const metadata = audibleToMetadata(product, "us");
    expect(metadata.abridged).toBe(true);
  });
});

describe("language and abridged in audnexusToMetadata", () => {
  it("maps language and formatType", () => {
    const book: AudnexusBook = {
      asin: "B08G9PRS1K",
      title: "Project Hail Mary",
      authors: [{ name: "Andy Weir" }],
      narrators: [{ name: "Ray Porter" }],
      language: "english",
      formatType: "unabridged",
    };
    const metadata = audnexusToMetadata(book, "us");
    expect(metadata.language).toBe("en");
    expect(metadata.abridged).toBe(false);
  });

  it("omits language and abridged when missing", () => {
    const book: AudnexusBook = {
      asin: "B08G9PRS1K",
      title: "Test",
      authors: [{ name: "Author" }],
      narrators: [{ name: "Narrator" }],
    };
    const metadata = audnexusToMetadata(book, "us");
    expect(metadata.language).toBeUndefined();
    expect(metadata.abridged).toBeUndefined();
  });
});
