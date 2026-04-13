import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildSlug,
  pickProductPath,
  yenpressScraper,
} from "../publishers/yenpress";
import { describe, expect, it } from "vitest";

const takagiSeriesHtml = readFileSync(
  resolve(__dirname, "fixtures/yenpress-takagi-series.html"),
  "utf-8",
);

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

describe("pickProductPath", () => {
  it("finds the product path for volume 6 from the real series page", () => {
    const path = pickProductPath(takagiSeriesHtml, 6);
    expect(path).toBe("/titles/9781975331702-teasing-master-takagi-san-vol-6");
  });

  it("finds higher-numbered volumes (vol 20)", () => {
    const path = pickProductPath(takagiSeriesHtml, 20);
    expect(path).toBe("/titles/9798855410716-teasing-master-takagi-san-vol-20");
  });

  it("returns null when the volume is absent", () => {
    expect(pickProductPath(takagiSeriesHtml, 999)).toBeNull();
  });

  it("does not confuse vol-1 with vol-10/11/12", () => {
    // Synthetic HTML where vol-10 appears BEFORE vol-1 in document order —
    // the picker must still return vol-1 when asked for 1, not vol-10.
    const html = `
      <a href="/titles/9999999999990-some-series-vol-10"></a>
      <a href="/titles/9999999999991-some-series-vol-1"></a>
    `;
    expect(pickProductPath(html, 1)).toBe(
      "/titles/9999999999991-some-series-vol-1",
    );
    expect(pickProductPath(html, 10)).toBe(
      "/titles/9999999999990-some-series-vol-10",
    );
  });
});
