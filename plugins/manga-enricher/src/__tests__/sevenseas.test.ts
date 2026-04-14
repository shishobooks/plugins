import { sevenseasScraper } from "../publishers/sevenseas";
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
