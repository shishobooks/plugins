import {
  getLiveEnglishPublishers,
  seriesToMetadata,
  titleCaseAuthorName,
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

  it("maps authors to ParsedAuthor with roles and title-cases surnames", () => {
    const md = seriesToMetadata(sampleSeries);
    expect(md.authors).toEqual([
      { name: "Oda Eiichiro", role: "writer" },
      { name: "Oda Eiichiro", role: "penciller" },
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

describe("getLiveEnglishPublishers", () => {
  it("returns the only English publisher when there's just one", () => {
    expect(getLiveEnglishPublishers(sampleSeries).map((p) => p.name)).toEqual([
      "VIZ Media",
    ]);
  });

  it("orders the most recent (last-listed) publisher first", () => {
    // MU lists publishers oldest-first. For Wotakoi the order is
    // [INKR, Kodansha Comics]; we want Kodansha Comics at index 0.
    const series: MUSeries = {
      ...sampleSeries,
      publishers: [
        { publisher_name: "INKR", type: "English" },
        {
          publisher_name: "Kodansha Comics",
          type: "English",
          notes: "6 2-in-1 Omnibuses - Complete",
        },
      ],
    };
    expect(getLiveEnglishPublishers(series).map((p) => p.name)).toEqual([
      "Kodansha Comics",
      "INKR",
    ]);
  });

  it("skips defunct and expired entries regardless of position", () => {
    // For Fruits Basket the chronological order is Chuang Yi (defunct),
    // TokyoPop (expired), Yen Press (live). Only Yen Press survives.
    const series: MUSeries = {
      ...sampleSeries,
      publishers: [
        {
          publisher_name: "Chuang Yi",
          type: "English",
          notes: "Defunct / 23 Vols - Complete",
        },
        {
          publisher_name: "TokyoPop",
          type: "English",
          notes: "Expired / 23 Vols - Complete",
        },
        {
          publisher_name: "Yen Press",
          type: "English",
          notes: "12 Collector's Edition Vols - Complete",
        },
      ],
    };
    expect(getLiveEnglishPublishers(series).map((p) => p.name)).toEqual([
      "Yen Press",
    ]);
  });

  it("returns an empty array when no English publisher is present", () => {
    const series: MUSeries = {
      ...sampleSeries,
      publishers: [{ publisher_name: "Shueisha", type: "Original" }],
    };
    expect(getLiveEnglishPublishers(series)).toEqual([]);
  });

  it("returns an empty array when publishers is missing", () => {
    const series: MUSeries = { series_id: 1, title: "X" };
    expect(getLiveEnglishPublishers(series)).toEqual([]);
  });
});

describe("titleCaseAuthorName", () => {
  it("title-cases an all-caps surname followed by a given name", () => {
    expect(titleCaseAuthorName("ODA Eiichiro")).toBe("Oda Eiichiro");
  });

  it("title-cases a single all-caps word", () => {
    expect(titleCaseAuthorName("KUBO")).toBe("Kubo");
  });

  it("leaves already-title-cased names unchanged", () => {
    expect(titleCaseAuthorName("Naoki Urasawa")).toBe("Naoki Urasawa");
  });

  it("leaves mixed-case words alone", () => {
    expect(titleCaseAuthorName("McDonald")).toBe("McDonald");
    expect(titleCaseAuthorName("deGrasse Tyson")).toBe("deGrasse Tyson");
  });

  it("handles multiple all-caps words", () => {
    expect(titleCaseAuthorName("SHIROW Masamune ABE")).toBe(
      "Shirow Masamune Abe",
    );
  });

  it("does not transform single capital letters", () => {
    // Single-letter capitals (initials) are left alone.
    expect(titleCaseAuthorName("J K Rowling")).toBe("J K Rowling");
  });

  it("preserves names with apostrophes", () => {
    expect(titleCaseAuthorName("O'NEILL John")).toBe("O'Neill John");
  });

  it("preserves whitespace between words", () => {
    expect(titleCaseAuthorName("ODA  Eiichiro")).toBe("Oda  Eiichiro");
  });
});
