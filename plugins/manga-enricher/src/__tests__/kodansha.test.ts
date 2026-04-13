import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { kodanshaScraper } from "../publishers/kodansha";
import { describe, expect, it, vi } from "vitest";

const aotHtml = readFileSync(
  resolve(__dirname, "fixtures/kodansha-aot-vol1.html"),
  "utf-8",
);

function mockFetch(status: number, ok: boolean, body: string) {
  vi.mocked(shisho.http.fetch).mockReturnValue({
    status,
    statusText: ok ? "OK" : "Error",
    ok,
    text: () => body,
    json: () => {
      throw new Error("not json");
    },
  } as unknown as ReturnType<typeof shisho.http.fetch>);
}

describe("kodanshaScraper.matchPublisher", () => {
  it("matches 'Kodansha USA'", () => {
    expect(kodanshaScraper.matchPublisher("Kodansha USA")).toBe(true);
  });

  it("matches 'Kodansha Comics'", () => {
    expect(kodanshaScraper.matchPublisher("Kodansha Comics")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(kodanshaScraper.matchPublisher("kodansha usa")).toBe(true);
  });

  it("does not match 'Shueisha' or 'Viz Media'", () => {
    expect(kodanshaScraper.matchPublisher("Shueisha")).toBe(false);
    expect(kodanshaScraper.matchPublisher("Viz Media")).toBe(false);
  });
});

describe("kodanshaScraper.searchVolume", () => {
  it("fetches the direct slug URL and parses JSON-LD", () => {
    mockFetch(200, true, aotHtml);

    const result = kodanshaScraper.searchVolume("Attack on Titan", 1);

    expect(result).not.toBeNull();
    expect(result?.description).toBeDefined();
    expect(result?.description?.length).toBeGreaterThan(20);
    expect(result?.url).toBe(
      "https://kodansha.us/series/attack-on-titan/volume-1/",
    );
    // If two ISBNs are present in workExample (ebook + paperback), the
    // ebook one must win.
    if (result?.isbn13) {
      expect(result.isbn13).toMatch(/^\d{13}$/);
    }
    // Cover URL should come from the Azuki CDN via JSON-LD.
    expect(result?.coverUrl).toMatch(
      /^https:\/\/production\.image\.azuki\.co\//,
    );
  });

  it("returns null on HTTP error", () => {
    mockFetch(404, false, "");
    expect(kodanshaScraper.searchVolume("Unknown Series", 1)).toBeNull();
  });

  it("slugifies the series title for the URL", () => {
    mockFetch(200, true, aotHtml);
    kodanshaScraper.searchVolume("Attack on Titan", 1);
    const call = vi.mocked(shisho.http.fetch).mock.calls[0];
    expect(call[0]).toBe(
      "https://kodansha.us/series/attack-on-titan/volume-1/",
    );
  });

  it("prefers the ebook ISBN when both are present", () => {
    // This test exercises the ebook-preference logic. We construct a
    // synthetic HTML blob with two ISBNs in workExample — one ebook, one
    // paperback — and confirm the ebook wins.
    const synthetic = `<html><head><script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Book",
  name: "Test Volume",
  description: "Test description goes here and is long enough.",
  workExample: [
    {
      "@type": "Book",
      bookFormat: "Paperback",
      isbn: "9781111111111",
      datePublished: "2020-01-01",
    },
    {
      "@type": "Book",
      bookFormat: "EBook",
      isbn: "9782222222222",
      datePublished: "2020-01-01",
    },
  ],
})}
</script></head><body></body></html>`;
    mockFetch(200, true, synthetic);

    const result = kodanshaScraper.searchVolume("Test", 1);
    expect(result?.isbn13).toBe("9782222222222");
  });

  it("reads og:description containing apostrophes without truncation", () => {
    const synthetic = `<html><head>
<meta property="og:description" content="Eren's dream drives the Survey Corps to a world they'd never imagined.">
<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Book",
      name: "Test",
      workExample: [],
    })}</script>
</head><body></body></html>`;

    mockFetch(200, true, synthetic);
    const result = kodanshaScraper.searchVolume("Test", 1);

    expect(result?.description).toBe(
      "Eren's dream drives the Survey Corps to a world they'd never imagined.",
    );
  });
});
