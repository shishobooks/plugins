import { sevenseasScraper, slugify } from "../publishers/sevenseas";
import { describe, expect, it } from "vitest";

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
