import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { vizScraper } from "../publishers/viz";
import { describe, expect, it, vi } from "vitest";

const searchHtml = readFileSync(
  resolve(__dirname, "fixtures/viz-one-piece-vol1-search.html"),
  "utf-8",
);
const productHtml = readFileSync(
  resolve(__dirname, "fixtures/viz-one-piece-vol1-product.html"),
  "utf-8",
);

function mockFetchSequence(
  responses: Array<{ status: number; ok: boolean; body: string }>,
) {
  const mock = vi.mocked(shisho.http.fetch);
  for (const r of responses) {
    mock.mockReturnValueOnce({
      status: r.status,
      statusText: r.ok ? "OK" : "Error",
      ok: r.ok,
      text: () => r.body,
      json: () => JSON.parse(r.body || "null"),
    } as unknown as ReturnType<typeof shisho.http.fetch>);
  }
}

describe("vizScraper.matchPublisher", () => {
  it("matches 'VIZ Media'", () => {
    expect(vizScraper.matchPublisher("VIZ Media")).toBe(true);
  });

  it("matches 'Viz Media, LLC'", () => {
    expect(vizScraper.matchPublisher("Viz Media, LLC")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(vizScraper.matchPublisher("viz media")).toBe(true);
  });

  it("does not match unrelated publishers", () => {
    expect(vizScraper.matchPublisher("Kodansha USA")).toBe(false);
    expect(vizScraper.matchPublisher("Yen Press")).toBe(false);
  });
});

describe("vizScraper.searchVolume", () => {
  it("fetches search then product and returns per-volume metadata", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: searchHtml },
      { status: 200, ok: true, body: productHtml },
    ]);

    const result = vizScraper.searchVolume("One Piece", 1);

    // Verify URLs passed to fetch
    const calls = vi.mocked(shisho.http.fetch).mock.calls;
    expect(calls[0][0]).toContain("viz.com/search");
    expect((calls[0][0] as string).toLowerCase()).toContain("one+piece");
    expect(calls[1][0]).toContain("viz.com/manga-books/manga/");

    expect(result).not.toBeNull();
    // Title should contain "One Piece" and "Vol. 1"
    expect(result?.title).toMatch(/one piece/i);
    expect(result?.title).toMatch(/vol\.\s*1/i);
    // Description should be the synopsis
    expect(result?.description).toBeDefined();
    expect(result?.description?.length).toBeGreaterThan(20);
    expect(result?.description).toMatch(/luffy/i);
    // URL must point to viz.com product page
    expect(result?.url).toContain("viz.com/manga-books/manga/");
    // ISBN-13 should be a 13-digit string
    if (result?.isbn13) {
      expect(result.isbn13).toMatch(/^\d{13}$/);
    }
    // Release date should be ISO 8601
    if (result?.releaseDate) {
      expect(result.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("returns null when the search page returns an error", () => {
    mockFetchSequence([{ status: 500, ok: false, body: "" }]);
    expect(vizScraper.searchVolume("One Piece", 1)).toBeNull();
  });

  it("returns null when the search page has no matching product link", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: "<html><body>nothing</body></html>" },
    ]);
    expect(vizScraper.searchVolume("One Piece", 1)).toBeNull();
  });

  it("returns null when the product page returns an error", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: searchHtml },
      { status: 500, ok: false, body: "" },
    ]);
    expect(vizScraper.searchVolume("One Piece", 1)).toBeNull();
  });

  it("includes the edition variant in the search query", () => {
    mockFetchSequence([
      {
        status: 200,
        ok: true,
        body: '<html><body><a href="/manga-books/manga/one-piece-omnibus-edition-volume-1-0/product/999">x</a></body></html>',
      },
      { status: 200, ok: true, body: "<html><body></body></html>" },
    ]);

    vizScraper.searchVolume("One Piece", 1, "Omnibus Edition");

    const searchUrl = vi.mocked(shisho.http.fetch).mock.calls[0][0] as string;
    expect(searchUrl).toContain("viz.com/search");
    // The URL must carry both the series title and the edition in the search param.
    // The exact encoding depends on searchParams — check that both words are present.
    expect(searchUrl.toLowerCase()).toContain("one+piece");
    expect(searchUrl.toLowerCase()).toContain("omnibus");
  });
});
