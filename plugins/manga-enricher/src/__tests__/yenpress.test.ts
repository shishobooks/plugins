import { buildSlug, yenpressScraper } from "../publishers/yenpress";
import { describe, expect, it } from "vitest";

describe("yenpressScraper.matchPublisher", () => {
  it("matches 'Yen Press'", () => {
    expect(yenpressScraper.matchPublisher("Yen Press")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(yenpressScraper.matchPublisher("yen press")).toBe(true);
  });

  it("tolerates extra whitespace", () => {
    expect(yenpressScraper.matchPublisher("Yen  Press")).toBe(true);
  });

  it("does not match unrelated publishers", () => {
    expect(yenpressScraper.matchPublisher("Kodansha USA")).toBe(false);
    expect(yenpressScraper.matchPublisher("Viz Media")).toBe(false);
  });

  it("does not match other Yen imprints (out of scope)", () => {
    expect(yenpressScraper.matchPublisher("Yen On")).toBe(false);
    expect(yenpressScraper.matchPublisher("JY")).toBe(false);
  });
});

describe("buildSlug", () => {
  it("slugifies a plain series title", () => {
    expect(buildSlug("Teasing Master Takagi-san")).toBe(
      "teasing-master-takagi-san",
    );
  });

  it("turns apostrophes into hyphens (not drops them)", () => {
    expect(buildSlug("Fruits Basket Collector's Edition")).toBe(
      "fruits-basket-collector-s-edition",
    );
  });

  it("appends edition to the series title", () => {
    expect(buildSlug("Fruits Basket", "Collector's Edition")).toBe(
      "fruits-basket-collector-s-edition",
    );
  });

  it("trims leading and trailing punctuation", () => {
    expect(buildSlug("  !Hello World!  ")).toBe("hello-world");
  });

  it("returns empty string for punctuation-only input", () => {
    expect(buildSlug("!!!")).toBe("");
  });
});
