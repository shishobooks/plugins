import { audibleToMetadata, audnexusToMetadata, stripHTML } from "../mapping";
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
