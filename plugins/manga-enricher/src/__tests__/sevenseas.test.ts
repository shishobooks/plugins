import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildProductPath,
  parseProduct,
  parseSevenSeasDate,
  sevenseasScraper,
  slugify,
} from "../publishers/sevenseas";
import { describe, expect, it, vi } from "vitest";

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

describe("parseProduct — ISBN", () => {
  it("extracts 979-8 prefix ISBN (365 Days fixture)", () => {
    const result = parseProduct(
      daysSeries365Html,
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    expect(result?.isbn13).toBe("9798888432631");
  });

  it("extracts 978 prefix ISBN (Tokyo Revengers omnibus fixture)", () => {
    const result = parseProduct(
      tokyoRevengersOmnibusHtml,
      "https://sevenseasentertainment.com/books/tokyo-revengers-omnibus-vol-1-2/",
    );
    expect(result?.isbn13).toBe("9781638585718");
  });

  it("extracts ISBN from new-template fixture (2.5 Dim Seduction)", () => {
    const result = parseProduct(
      dim25Html,
      "https://sevenseasentertainment.com/books/2-5-dimensional-seduction-vol-1/",
    );
    expect(result?.isbn13).toBe("9781648278815");
  });

  it("omits ISBN when #volume-meta is absent", () => {
    const result = parseProduct("<html><body></body></html>", "https://x/");
    expect(result?.isbn13).toBeUndefined();
  });

  it("omits ISBN when the value is not 13 digits after hyphen stripping", () => {
    const html = `
      <html><body>
        <div id="volume-meta">
          <p><b>ISBN:</b> 123-456</p>
        </div>
        <div id="single-book-retailers"></div>
      </body></html>
    `;
    const result = parseProduct(html, "https://x/");
    expect(result?.isbn13).toBeUndefined();
  });
});

describe("parseProduct — release date", () => {
  it("parses the month-name date from the 365 Days fixture", () => {
    const result = parseProduct(
      daysSeries365Html,
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    expect(result?.releaseDate).toBe("2023-11-14T00:00:00Z");
  });

  it("parses the slash-format date from the Tokyo Revengers omnibus fixture", () => {
    const result = parseProduct(
      tokyoRevengersOmnibusHtml,
      "https://sevenseasentertainment.com/books/tokyo-revengers-omnibus-vol-1-2/",
    );
    expect(result?.releaseDate).toBe("2022-07-26T00:00:00Z");
  });

  it("parses the month-name date from the new-template fixture", () => {
    const result = parseProduct(
      dim25Html,
      "https://sevenseasentertainment.com/books/2-5-dimensional-seduction-vol-1/",
    );
    expect(result?.releaseDate).toBe("2022-02-08T00:00:00Z");
  });

  it("omits releaseDate when #volume-meta is absent", () => {
    const result = parseProduct("<html><body></body></html>", "https://x/");
    expect(result?.releaseDate).toBeUndefined();
  });
});

describe("parseProduct — description", () => {
  it("extracts the description from the 365 Days fixture", () => {
    const result = parseProduct(
      daysSeries365Html,
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    expect(result?.description).toMatch(/^A sweet .fake engagement. romance/);
    // Must contain both the tagline <strong> paragraph and the body.
    expect(result?.description).toContain("J.T.C. travel agency");
    // No HTML tags leaked through.
    expect(result?.description).not.toMatch(/</);
  });

  it("extracts the description from the Tokyo Revengers omnibus fixture", () => {
    const result = parseProduct(
      tokyoRevengersOmnibusHtml,
      "https://sevenseasentertainment.com/books/tokyo-revengers-omnibus-vol-1-2/",
    );
    expect(result?.description).toMatch(/^The critically acclaimed manga/);
    expect(result?.description).toContain("Hanagaki Takemichi");
  });

  it("extracts the description from the 2.5 Dim fixture (new template)", () => {
    const result = parseProduct(
      dim25Html,
      "https://sevenseasentertainment.com/books/2-5-dimensional-seduction-vol-1/",
    );
    expect(result?.description).toMatch(
      /^A hot-blooded romantic cosplay comedy/,
    );
    expect(result?.description).toContain("Okumura");
  });

  it("drops the bookcrew (translator credits) paragraph", () => {
    const result = parseProduct(
      daysSeries365Html,
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    expect(result?.description).not.toContain("Kristjan Rohde");
    expect(result?.description).not.toContain("Translation");
  });

  it("joins multiple paragraphs with a blank line", () => {
    const result = parseProduct(
      daysSeries365Html,
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    // Tagline (<strong>) paragraph followed by body paragraph — verify
    // they are separated by a blank line, not run together.
    expect(result?.description).toMatch(/!\n\nThe J\.T\.C/);
  });

  it("omits description when #volume-meta is absent", () => {
    const result = parseProduct("<html><body></body></html>", "https://x/");
    expect(result?.description).toBeUndefined();
  });
});

describe("parseProduct — graceful failure", () => {
  it("returns { url } for completely empty HTML", () => {
    const result = parseProduct("", "https://x/");
    expect(result).not.toBeNull();
    expect(result?.url).toBe("https://x/");
    expect(result?.coverUrl).toBeUndefined();
    expect(result?.imprint).toBeUndefined();
    expect(result?.isbn13).toBeUndefined();
    expect(result?.releaseDate).toBeUndefined();
    expect(result?.description).toBeUndefined();
  });

  it("returns { url } for a page with only a 404 body", () => {
    const result = parseProduct(
      "<html><body><h1>404 Not Found</h1></body></html>",
      "https://x/",
    );
    expect(result?.url).toBe("https://x/");
    expect(result?.isbn13).toBeUndefined();
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

describe("sevenseasScraper.searchVolume", () => {
  it("fetches the product page directly and returns merged metadata", () => {
    mockFetchSequence([{ status: 200, ok: true, body: daysSeries365Html }]);

    const result = sevenseasScraper.searchVolume("365 Days to the Wedding", 1);

    expect(result).not.toBeNull();
    expect(result?.url).toBe(
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
    expect(result?.isbn13).toBe("9798888432631");
    expect(result?.releaseDate).toBe("2023-11-14T00:00:00Z");

    const calls = vi.mocked(shisho.http.fetch).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(
      "https://sevenseasentertainment.com/books/365-days-to-the-wedding-vol-1/",
    );
  });

  it("constructs the 2-in-1 omnibus URL when edition is 'Omnibus'", () => {
    mockFetchSequence([
      { status: 200, ok: true, body: tokyoRevengersOmnibusHtml },
    ]);

    const result = sevenseasScraper.searchVolume(
      "Tokyo Revengers",
      1,
      "Omnibus",
    );

    expect(result?.isbn13).toBe("9781638585718");
    const calls = vi.mocked(shisho.http.fetch).mock.calls;
    expect(calls[0][0]).toBe(
      "https://sevenseasentertainment.com/books/tokyo-revengers-omnibus-vol-1-2/",
    );
  });

  it("folds a non-omnibus edition into the slug", () => {
    mockFetchSequence([{ status: 404, ok: false, body: "" }]);

    sevenseasScraper.searchVolume("Rozen Maiden", 5, "Collector's Edition");

    const calls = vi.mocked(shisho.http.fetch).mock.calls;
    expect(calls[0][0]).toBe(
      "https://sevenseasentertainment.com/books/rozen-maiden-collectors-edition-vol-5/",
    );
  });

  it("returns null when the product page 404s", () => {
    mockFetchSequence([{ status: 404, ok: false, body: "" }]);
    expect(sevenseasScraper.searchVolume("No Such Series", 1)).toBeNull();
  });

  it("returns null when the fetch helper returns null (network error)", () => {
    const mock = vi.mocked(shisho.http.fetch);
    mock.mockReset();
    mock.mockReturnValueOnce(
      null as unknown as ReturnType<typeof shisho.http.fetch>,
    );
    expect(sevenseasScraper.searchVolume("Some Series", 1)).toBeNull();
  });

  it("returns null when shisho.http.fetch throws (anti-bot / TLS error)", () => {
    // Seven Seas' Cloudflare edge has been observed to make the host's
    // fetch throw instead of returning a !ok response. An uncaught throw
    // here would bubble up through findVolumeData and kill the entire
    // search for the file — the scraper must swallow it and return null.
    const mock = vi.mocked(shisho.http.fetch);
    mock.mockReset();
    mock.mockImplementationOnce(() => {
      throw new Error("fetch: blocked by anti-bot");
    });
    expect(sevenseasScraper.searchVolume("Some Series", 1)).toBeNull();
  });

  it("returns null for punctuation-only or empty titles without fetching", () => {
    const mock = vi.mocked(shisho.http.fetch);
    mock.mockReset();
    expect(sevenseasScraper.searchVolume("", 1)).toBeNull();
    expect(sevenseasScraper.searchVolume("!!!", 1)).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });
});
