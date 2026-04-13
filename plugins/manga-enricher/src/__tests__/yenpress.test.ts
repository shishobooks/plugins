import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildSlug,
  parseProduct,
  parseYenPressDate,
  pickProductPath,
  yenpressScraper,
} from "../publishers/yenpress";
import { describe, expect, it, vi } from "vitest";

const takagiSeriesHtml = readFileSync(
  resolve(__dirname, "fixtures/yenpress-takagi-series.html"),
  "utf-8",
);

const takagiProductHtml = readFileSync(
  resolve(__dirname, "fixtures/yenpress-takagi-vol1-product.html"),
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
  const takagiSlug = "teasing-master-takagi-san";

  it("finds the product path for volume 6 from the real series page", () => {
    const path = pickProductPath(takagiSeriesHtml, takagiSlug, 6);
    expect(path).toBe("/titles/9781975331702-teasing-master-takagi-san-vol-6");
  });

  it("finds higher-numbered volumes (vol 20)", () => {
    const path = pickProductPath(takagiSeriesHtml, takagiSlug, 20);
    expect(path).toBe("/titles/9798855410716-teasing-master-takagi-san-vol-20");
  });

  it("returns null when the volume is absent", () => {
    expect(pickProductPath(takagiSeriesHtml, takagiSlug, 999)).toBeNull();
  });

  it("does not confuse vol-1 with vol-10/11/12", () => {
    // Synthetic HTML where vol-10 appears BEFORE vol-1 in document order —
    // the picker must still return vol-1 when asked for 1, not vol-10.
    const html = `
      <a href="/titles/9999999999990-some-series-vol-10"></a>
      <a href="/titles/9999999999991-some-series-vol-1"></a>
    `;
    expect(pickProductPath(html, "some-series", 1)).toBe(
      "/titles/9999999999991-some-series-vol-1",
    );
    expect(pickProductPath(html, "some-series", 10)).toBe(
      "/titles/9999999999990-some-series-vol-10",
    );
  });

  it("ignores cross-promotional links from other series", () => {
    // Yen Press series pages embed carousels of unrelated titles. The
    // first vol-1 link on the page is often a cross-promo, NOT the
    // requested series. The picker must filter by slug to avoid
    // returning the wrong title.
    const html = `
      <a href="/titles/9798855419429-how-to-love-a-loser-vol-1"></a>
      <a href="/titles/9798855435481-banished-from-the-hero-s-party-vol-1"></a>
      <a href="/titles/9780316360166-fruits-basket-collector-s-edition-vol-1"></a>
    `;
    expect(pickProductPath(html, "fruits-basket-collector-s-edition", 1)).toBe(
      "/titles/9780316360166-fruits-basket-collector-s-edition-vol-1",
    );
  });

  it("returns null when only cross-promo vol-N links exist for the wrong slug", () => {
    const html = `
      <a href="/titles/9798855419429-how-to-love-a-loser-vol-1"></a>
    `;
    expect(
      pickProductPath(html, "fruits-basket-collector-s-edition", 1),
    ).toBeNull();
  });
});

describe("parseYenPressDate", () => {
  it("parses short month names", () => {
    expect(parseYenPressDate("Jul 24, 2018")).toBe("2018-07-24T00:00:00Z");
  });

  it("parses long month names", () => {
    expect(parseYenPressDate("September 5, 2023")).toBe("2023-09-05T00:00:00Z");
  });

  it("zero-pads single-digit days", () => {
    expect(parseYenPressDate("Jan 3, 2020")).toBe("2020-01-03T00:00:00Z");
  });

  it("tolerates extra whitespace", () => {
    expect(parseYenPressDate("  Jul   24 , 2018  ")).toBe(
      "2018-07-24T00:00:00Z",
    );
  });

  it("returns undefined for unparseable input", () => {
    expect(parseYenPressDate("")).toBeUndefined();
    expect(parseYenPressDate("TBD")).toBeUndefined();
    expect(parseYenPressDate("2018-07-24")).toBeUndefined();
  });
});

describe("parseProduct — description and cover", () => {
  const productUrl =
    "https://yenpress.com/titles/9781975353308-teasing-master-takagi-san-vol-1";

  it("extracts the volume description", () => {
    const result = parseProduct(takagiProductHtml, productUrl);
    expect(result).not.toBeNull();
    expect(result?.description).toMatch(/^Middle schooler Nishikata/);
    // Description must not contain HTML tags.
    expect(result?.description).not.toMatch(/</);
  });

  it("sets the url field to the passed-in value", () => {
    const result = parseProduct(takagiProductHtml, productUrl);
    expect(result?.url).toBe(productUrl);
  });

  it("extracts the cover image URL", () => {
    const result = parseProduct(takagiProductHtml, productUrl);
    expect(result?.coverUrl).toMatch(
      /^https:\/\/images\.yenpress\.com\/imgs\//,
    );
  });
});

describe("parseProduct — detail-box fields", () => {
  const productUrl =
    "https://yenpress.com/titles/9781975353308-teasing-master-takagi-san-vol-1";

  it("extracts imprint", () => {
    const result = parseProduct(takagiProductHtml, productUrl);
    expect(result?.imprint).toBe("Yen Press");
  });

  it("prefers the digital ISBN over the print ISBN when both exist", () => {
    // Print ISBN is 9781975353308 (in the URL), digital is 9781975386122
    // (in the second detail-info block). Preference rule: digital wins.
    const result = parseProduct(takagiProductHtml, productUrl);
    expect(result?.isbn13).toBe("9781975386122");
  });

  it("extracts the release date as ISO 8601", () => {
    // First (print) block says Jul 24, 2018; digital block says Jul 23,
    // 2019. Release date follows the same digital-preferred rule as ISBN
    // — it's read from whichever detail-info block we picked.
    const result = parseProduct(takagiProductHtml, productUrl);
    expect(result?.releaseDate).toBe("2019-07-23T00:00:00Z");
  });

  it("falls back to the only block when there is just one", () => {
    const singleBlockHtml = `
      <html><body>
        <div class="detail-info">
          <div class="detail-box">
            <span class="type">ISBN</span>
            <p class="info">9780000000001</p>
          </div>
          <div class="detail-box">
            <span class="type">Release Date</span>
            <p class="info">Jan 1, 2020</p>
          </div>
          <div class="detail-box">
            <span class="type">Imprint</span>
            <p class="info">Yen Press</p>
          </div>
        </div>
      </body></html>
    `;
    const result = parseProduct(singleBlockHtml, "https://yenpress.com/x");
    expect(result?.isbn13).toBe("9780000000001");
    expect(result?.releaseDate).toBe("2020-01-01T00:00:00Z");
    expect(result?.imprint).toBe("Yen Press");
  });

  it("omits missing fields rather than throwing", () => {
    const emptyHtml = "<html><body></body></html>";
    const result = parseProduct(emptyHtml, "https://yenpress.com/x");
    expect(result).not.toBeNull();
    expect(result?.isbn13).toBeUndefined();
    expect(result?.releaseDate).toBeUndefined();
    expect(result?.imprint).toBeUndefined();
  });

  it("normalizes ISBN by stripping hyphens", () => {
    const html = `
      <html><body>
        <div class="detail-info">
          <div class="detail-box">
            <span class="type">ISBN</span>
            <p class="info">978-1-9753-5330-8</p>
          </div>
        </div>
      </body></html>
    `;
    const result = parseProduct(html, "https://yenpress.com/x");
    expect(result?.isbn13).toBe("9781975353308");
  });
});

function mockFetchSequence(
  responses: Array<{ status: number; ok: boolean; body: string }>,
) {
  const mock = vi.mocked(shisho.http.fetch);
  mock.mockReset();
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

describe("yenpressScraper.searchVolume", () => {
  it("fetches the series page then the product page and returns merged metadata", () => {
    // The Takagi series fixture contains vols 6-20; we search for vol 6.
    // The product page fixture is for vol 1 (its body fields come through
    // unchanged); we only verify the plumbing: that two fetches happen
    // with the right URLs and the result carries the product-page ISBN.
    mockFetchSequence([
      { status: 200, ok: true, body: takagiSeriesHtml },
      { status: 200, ok: true, body: takagiProductHtml },
    ]);

    const result = yenpressScraper.searchVolume("Teasing Master Takagi-san", 6);

    expect(result).not.toBeNull();
    expect(result?.url).toBe(
      "https://yenpress.com/titles/9781975331702-teasing-master-takagi-san-vol-6",
    );
    // The body fields come from whatever product HTML we returned — in
    // this test, that's the vol-1 page, whose digital ISBN is
    // 9781975386122. We're testing that parseProduct's output reaches
    // the caller intact, not that the product page actually describes
    // vol-6.
    expect(result?.isbn13).toBe("9781975386122");
    expect(result?.imprint).toBe("Yen Press");
    expect(result?.description).toMatch(/^Middle schooler Nishikata/);

    const calls = vi.mocked(shisho.http.fetch).mock.calls;
    expect(calls[0][0]).toBe(
      "https://yenpress.com/series/teasing-master-takagi-san",
    );
    expect(calls[1][0]).toBe(
      "https://yenpress.com/titles/9781975331702-teasing-master-takagi-san-vol-6",
    );
  });

  it("appends edition to the slug before fetching the series page", () => {
    mockFetchSequence([
      { status: 404, ok: false, body: "" }, // series fetch fails
    ]);

    yenpressScraper.searchVolume("Fruits Basket", 1, "Collector's Edition");

    const calls = vi.mocked(shisho.http.fetch).mock.calls;
    expect(calls[0][0]).toBe(
      "https://yenpress.com/series/fruits-basket-collector-s-edition",
    );
  });

  it("returns null when the series page 404s", () => {
    mockFetchSequence([{ status: 404, ok: false, body: "" }]);
    expect(yenpressScraper.searchVolume("No Such Series", 1)).toBeNull();
  });

  it("returns null when the series page has no matching volume", () => {
    mockFetchSequence([{ status: 200, ok: true, body: takagiSeriesHtml }]);
    expect(
      yenpressScraper.searchVolume("Teasing Master Takagi-san", 999),
    ).toBeNull();
  });

  it("returns null when the product page 404s", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: takagiSeriesHtml },
      { status: 404, ok: false, body: "" },
    ]);
    expect(
      yenpressScraper.searchVolume("Teasing Master Takagi-san", 6),
    ).toBeNull();
  });

  it("returns null when the series title is empty or punctuation-only", () => {
    mockFetchSequence([]);
    expect(yenpressScraper.searchVolume("", 1)).toBeNull();
    expect(yenpressScraper.searchVolume("!!!", 1)).toBeNull();
    // No HTTP call should have been made.
    expect(vi.mocked(shisho.http.fetch)).not.toHaveBeenCalled();
  });
});
