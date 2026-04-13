import {
  pickEnglishPublisher,
  seriesToMetadata,
} from "../mangaupdates/mapping";
import type { MUSeries } from "../mangaupdates/types";
import { describe, expect, it } from "vitest";

const sampleSeries: MUSeries = {
  series_id: 55099564912,
  title: "One Piece",
  url: "https://www.mangaupdates.com/series/pb8uwds/one-piece",
  description: "From Viz:  \nAs a child, Monkey D. Luffy...",
  type: "Manga",
  year: "1997",
  status: "114 Volumes (Ongoing)",
  associated: [{ title: "ワンピース" }, { title: "海贼王" }],
  genres: [{ genre: "Action" }, { genre: "Adventure" }, { genre: "Shounen" }],
  categories: [
    { category: "Pirates", votes: 200 },
    { category: "Devil Fruits", votes: 150 },
    { category: "Low-quality", votes: 1 },
  ],
  authors: [
    { name: "ODA Eiichiro", type: "Author" },
    { name: "ODA Eiichiro", type: "Artist" },
  ],
  publishers: [
    { publisher_name: "Shueisha", type: "Original" },
    { publisher_name: "VIZ Media", type: "English" },
  ],
};

describe("seriesToMetadata", () => {
  it("maps core series fields", () => {
    const md = seriesToMetadata(sampleSeries);
    expect(md.title).toBe("One Piece");
    expect(md.series).toBe("One Piece");
    expect(md.url).toBe(sampleSeries.url);
    expect(md.language).toBe("en");
    expect(md.identifiers).toEqual([
      { type: "mangaupdates_series", value: "55099564912" },
    ]);
  });

  it("maps authors to ParsedAuthor with roles", () => {
    const md = seriesToMetadata(sampleSeries);
    expect(md.authors).toEqual([
      { name: "ODA Eiichiro", role: "writer" },
      { name: "ODA Eiichiro", role: "penciller" },
    ]);
  });

  it("maps genres from genres[]", () => {
    const md = seriesToMetadata(sampleSeries);
    expect(md.genres).toEqual(["Action", "Adventure", "Shounen"]);
  });

  it("maps tags from categories[], filtering low-vote entries", () => {
    const md = seriesToMetadata(sampleSeries);
    // categories with votes >= 2 survive (the "Low-quality" one is dropped)
    expect(md.tags).toEqual(["Pirates", "Devil Fruits"]);
  });

  it("uses the English publisher as the primary publisher", () => {
    const md = seriesToMetadata(sampleSeries);
    expect(md.publisher).toBe("VIZ Media");
  });

  it("maps the MU cover image to coverUrl", () => {
    const series: MUSeries = {
      ...sampleSeries,
      image: {
        url: {
          original: "https://cdn.mangaupdates.com/image/i517997.jpg",
          thumb: "https://cdn.mangaupdates.com/image/thumb/i517997.jpg",
        },
        width: 254,
        height: 400,
      },
    };
    const md = seriesToMetadata(series);
    expect(md.coverUrl).toBe("https://cdn.mangaupdates.com/image/i517997.jpg");
  });

  it("leaves coverUrl undefined when MU has no image", () => {
    const md = seriesToMetadata(sampleSeries);
    expect(md.coverUrl).toBeUndefined();
  });

  it("strips HTML from the description", () => {
    const series: MUSeries = {
      ...sampleSeries,
      description: "<p>Paragraph one.</p><p>Paragraph two.</p>",
    };
    const md = seriesToMetadata(series);
    expect(md.description).toBe("Paragraph one.\n\nParagraph two.");
  });

  it("omits empty optional fields", () => {
    const minimal: MUSeries = { series_id: 1, title: "X" };
    const md = seriesToMetadata(minimal);
    expect(md.title).toBe("X");
    expect(md.authors).toBeUndefined();
    expect(md.publisher).toBeUndefined();
    expect(md.genres).toBeUndefined();
    expect(md.tags).toBeUndefined();
    expect(md.description).toBeUndefined();
  });
});

describe("pickEnglishPublisher", () => {
  it("returns the first publisher with type 'English'", () => {
    expect(pickEnglishPublisher(sampleSeries)).toBe("VIZ Media");
  });

  it("returns undefined when no English publisher is present", () => {
    const series: MUSeries = {
      ...sampleSeries,
      publishers: [{ publisher_name: "Shueisha", type: "Original" }],
    };
    expect(pickEnglishPublisher(series)).toBeUndefined();
  });

  it("returns undefined when publishers is missing", () => {
    const series: MUSeries = { series_id: 1, title: "X" };
    expect(pickEnglishPublisher(series)).toBeUndefined();
  });
});
