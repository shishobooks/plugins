import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildProductPath,
  parseProduct,
  parseSevenSeasDate,
  sevenseasScraper,
  slugify,
} from "../publishers/sevenseas";
import { describe, expect, it } from "vitest";

const daysSeries365Html = readFileSync(
  resolve(__dirname, "fixtures/sevenseas-365-days-vol1.html"),
  "utf-8",
);

const tokyoRevengersOmnibusHtml = readFileSync(
  resolve(__dirname, "fixtures/sevenseas-tokyo-revengers-omnibus-vol1-2.html"),
  "utf-8",
);

const dim25Html = readFileSync(
  resolve(__dirname, "fixtures/sevenseas-25dim-seduction-vol1.html"),
  "utf-8",
);

describe("sevenseasScraper.matchPublisher", () => {
  it("matches 'Seven Seas'", () => {
    expect(sevenseasScraper.matchPublisher("Seven Seas")).toBe(true);
  });

  it("matches 'Seven Seas Entertainment'", () => {
    expect(sevenseasScraper.matchPublisher("Seven Seas Entertainment")).toBe(
      true,
    );
  });

  it("is case-insensitive", () => {
    expect(sevenseasScraper.matchPublisher("seven seas")).toBe(true);
  });

  it("tolerates extra whitespace between words", () => {
    expect(sevenseasScraper.matchPublisher("Seven  Seas")).toBe(true);
  });

  it("does not match unrelated publishers", () => {
    expect(sevenseasScraper.matchPublisher("Yen Press")).toBe(false);
    expect(sevenseasScraper.matchPublisher("Viz Media")).toBe(false);
    expect(sevenseasScraper.matchPublisher("Kodansha USA")).toBe(false);
  });

  it("does not match bare imprint names (known MVP limitation)", () => {
    // MangaUpdates sometimes lists Seven Seas sub-imprints as standalone
    // publishers ("Ghost Ship", "Airship", "Steamship"). The MVP scraper
    // only claims titles whose MU publisher string contains "Seven Seas".
    // Filed as a follow-up; this test documents the boundary.
    expect(sevenseasScraper.matchPublisher("Ghost Ship")).toBe(false);
    expect(sevenseasScraper.matchPublisher("Airship")).toBe(false);
  });
});

describe("slugify", () => {
  it("slugifies a plain series title", () => {
    expect(slugify("Monster Musume")).toBe("monster-musume");
  });

  it("collapses periods in numeric prefixes", () => {
    // Seven Seas: /books/2-5-dimensional-seduction-vol-1/
    expect(slugify("2.5 Dimensional Seduction")).toBe(
      "2-5-dimensional-seduction",
    );
  });

  it("drops ASCII apostrophes (Kodansha-style, not Yen Press-style)", () => {
    // Confirmed by /books/rozen-maiden-collectors-edition-vol-5/ (no stray
    // hyphen between "collector" and "s").
    expect(slugify("Rozen Maiden Collector's Edition")).toBe(
      "rozen-maiden-collectors-edition",
    );
  });

  it("drops Unicode right-single-quote (U+2019)", () => {
    expect(slugify("Rozen Maiden Collector\u2019s Edition")).toBe(
      "rozen-maiden-collectors-edition",
    );
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  !Hello World!  ")).toBe("hello-world");
  });

  it("returns empty string for punctuation-only input", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("buildProductPath", () => {
  it("builds a plain volume path", () => {
    expect(buildProductPath("Monster Musume", 1)).toBe(
      "/books/monster-musume-vol-1/",
    );
  });

  it("appends a non-omnibus edition to the slug", () => {
    expect(buildProductPath("Rozen Maiden", 5, "Collector's Edition")).toBe(
      "/books/rozen-maiden-collectors-edition-vol-5/",
    );
  });

  it("builds a 2-in-1 omnibus range URL (omnibus sequence 1 -> vols 1-2)", () => {
    expect(buildProductPath("Tokyo Revengers", 1, "Omnibus")).toBe(
      "/books/tokyo-revengers-omnibus-vol-1-2/",
    );
  });

  it("builds a 2-in-1 omnibus range URL (omnibus sequence 3 -> vols 5-6)", () => {
    expect(buildProductPath("Tokyo Revengers", 3, "Omnibus")).toBe(
      "/books/tokyo-revengers-omnibus-vol-5-6/",
    );
  });

  it("detects 'omnibus' case-insensitively", () => {
    expect(buildProductPath("Tokyo Revengers", 1, "omnibus")).toBe(
      "/books/tokyo-revengers-omnibus-vol-1-2/",
    );
  });

  it("does NOT fold an omnibus edition into the slug", () => {
    // The slug is the base series slug; the "-omnibus-" segment is
    // injected separately. Verifies we don't produce
    // /books/tokyo-revengers-omnibus-omnibus-vol-1-2/.
    const path = buildProductPath("Tokyo Revengers", 1, "Omnibus");
    expect(path).not.toMatch(/-omnibus-omnibus-/);
  });

  it("returns null when the slug is empty (punctuation-only title)", () => {
    expect(buildProductPath("!!!", 1)).toBeNull();
  });
});

describe("parseSevenSeasDate", () => {
  it("parses long month names", () => {
    expect(parseSevenSeasDate("November 14, 2023")).toBe(
      "2023-11-14T00:00:00Z",
    );
  });

  it("parses short month names", () => {
    expect(parseSevenSeasDate("Nov 14, 2023")).toBe("2023-11-14T00:00:00Z");
  });

  it("parses YYYY/MM/DD slash format (old template)", () => {
    expect(parseSevenSeasDate("2022/07/26")).toBe("2022-07-26T00:00:00Z");
  });

  it("parses YYYY/M/D slash format with single digits", () => {
    expect(parseSevenSeasDate("2013/1/5")).toBe("2013-01-05T00:00:00Z");
  });

  it("zero-pads single-digit days in month-name format", () => {
    expect(parseSevenSeasDate("Feb 3, 2020")).toBe("2020-02-03T00:00:00Z");
  });

  it("tolerates extra whitespace", () => {
    expect(parseSevenSeasDate("  November  14 , 2023 ")).toBe(
      "2023-11-14T00:00:00Z",
    );
  });

  it("returns undefined for unparseable input", () => {
    expect(parseSevenSeasDate("")).toBeUndefined();
    expect(parseSevenSeasDate("TBA")).toBeUndefined();
    // ISO-dash format is NOT accepted — Seven Seas doesn't produce it,
    // and accepting it would mask upstream bugs.
    expect(parseSevenSeasDate("2022-07-26")).toBeUndefined();
  });
});

describe("parseProduct — cover and url plumbing", () => {
  const daysUrl =
    "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/";

  it("sets the url field to the passed-in value", () => {
    const result = parseProduct(daysSeries365Html, daysUrl);
    expect(result?.url).toBe(daysUrl);
  });

  it("extracts the cover URL from #volume-cover img[src]", () => {
    const result = parseProduct(daysSeries365Html, daysUrl);
    expect(result?.coverUrl).toBe(
      "https://sevenseasentertainment.com/wp-content/uploads/2023/07/365ToWeddingM1_site.jpg",
    );
  });

  it("extracts cover for the old-template omnibus fixture", () => {
    const url =
      "https://sevenseasentertainment.com/books/tokyo-revengers-omnibus-vol-1-2/";
    const result = parseProduct(tokyoRevengersOmnibusHtml, url);
    expect(result?.coverUrl).toBe(
      "https://sevenseasentertainment.com/wp-content/uploads/2022/02/tokyorevengers1-2_site.jpg",
    );
  });

  it("extracts cover for the new-template Ghost Ship fixture", () => {
    const url =
      "https://sevenseasentertainment.com/books/2-5-dimensional-seduction-vol-1/";
    const result = parseProduct(dim25Html, url);
    expect(result?.coverUrl).toBe(
      "https://sevenseasentertainment.com/wp-content/uploads/2021/12/2.5-Dimensional-Seduction1_site.jpg",
    );
  });

  it("omits coverUrl when the page has no #volume-cover element", () => {
    const result = parseProduct("<html><body></body></html>", "https://x/");
    expect(result).not.toBeNull();
    expect(result?.url).toBe("https://x/");
    expect(result?.coverUrl).toBeUndefined();
  });
});

describe("parseProduct — imprint", () => {
  it("extracts 'Ghost Ship' from the #GS-block div (nested <a>)", () => {
    const result = parseProduct(
      dim25Html,
      "https://sevenseasentertainment.com/books/2-5-dimensional-seduction-vol-1/",
    );
    expect(result?.imprint).toBe("Ghost Ship");
  });

  it("extracts a plain-text imprint from the #SS-block div", () => {
    // Synthetic HTML — the Steamship fixture (Ladies on Top) isn't
    // included as a full fixture since Ghost Ship already exercises the
    // nested-<a> variant; this test covers the plain-text sibling shape
    // (<div id="SS-block" class="age-rating">Steamship</div>) that the
    // old template uses when the label is unlinked.
    const html = `
      <html><body>
        <div id="volume-cover">
          <img src="https://sevenseasentertainment.com/cover.jpg">
          <div id="SS-block" class="age-rating">Steamship</div>
          <div class="age-rating" id="olderteen17"></div>
        </div>
      </body></html>
    `;
    const result = parseProduct(html, "https://sevenseasentertainment.com/x/");
    expect(result?.imprint).toBe("Steamship");
  });

  it("omits imprint when only the age-rating badge is present (main SS line)", () => {
    // The 365 Days fixture has <div class="age-rating" id="teen"></div>
    // but no -block sibling — this is the main Seven Seas line.
    const result = parseProduct(
      daysSeries365Html,
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    expect(result?.imprint).toBeUndefined();
  });
});
