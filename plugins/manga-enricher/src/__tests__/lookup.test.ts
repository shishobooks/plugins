import { searchForManga } from "../lookup";
import { fetchSeries, searchSeries } from "../mangaupdates/api";
import type { MUSeries } from "../mangaupdates/types";
import { kodanshaScraper } from "../publishers/kodansha";
import { vizScraper } from "../publishers/viz";
import type { SearchContext } from "@shisho/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("../mangaupdates/api", () => ({
  searchSeries: vi.fn(),
  fetchSeries: vi.fn(),
}));

vi.mock("../publishers/viz", () => ({
  vizScraper: {
    name: "Viz Media",
    matchPublisher: vi.fn(),
    searchVolume: vi.fn(),
  },
}));

vi.mock("../publishers/kodansha", () => ({
  kodanshaScraper: {
    name: "Kodansha USA",
    matchPublisher: vi.fn(),
    searchVolume: vi.fn(),
  },
}));

const mockedSearchSeries = vi.mocked(searchSeries);
const mockedFetchSeries = vi.mocked(fetchSeries);
const mockedVizMatch = vi.mocked(vizScraper.matchPublisher);
const mockedVizSearch = vi.mocked(vizScraper.searchVolume);
const mockedKodanshaMatch = vi.mocked(kodanshaScraper.matchPublisher);
const mockedKodanshaSearch = vi.mocked(kodanshaScraper.searchVolume);

function makeContext(overrides: Partial<SearchContext> = {}): SearchContext {
  return { query: "", ...overrides };
}

const onePieceSeries: MUSeries = {
  series_id: 55099564912,
  title: "One Piece",
  url: "https://www.mangaupdates.com/series/pb8uwds/one-piece",
  description: "From Viz: As a child, Monkey D. Luffy...",
  authors: [{ name: "ODA Eiichiro", type: "Author" }],
  genres: [{ genre: "Action" }, { genre: "Shounen" }],
  publishers: [{ publisher_name: "VIZ Media", type: "English" }],
  status: "114 Volumes (Ongoing)",
};

function setupDefaultMocks() {
  mockedSearchSeries.mockReturnValue(null);
  mockedFetchSeries.mockReturnValue(null);
  mockedVizMatch.mockImplementation((p: string) => /viz/i.test(p));
  mockedVizSearch.mockReturnValue(null);
  mockedKodanshaMatch.mockImplementation((p: string) => /kodansha/i.test(p));
  mockedKodanshaSearch.mockReturnValue(null);
}

describe("searchForManga", () => {
  describe("Tier 1: mangaupdates_series ID lookup", () => {
    it("fetches the series directly when identifier is present", () => {
      setupDefaultMocks();
      mockedFetchSeries.mockReturnValue(onePieceSeries);

      const context = makeContext({
        query: "One Piece v01.cbz",
        identifiers: [{ type: "mangaupdates_series", value: "55099564912" }],
      });

      const results = searchForManga(context);

      expect(mockedFetchSeries).toHaveBeenCalledWith(55099564912);
      expect(mockedSearchSeries).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
      expect(results[0].title).toBe("One Piece");
      expect(results[0].seriesNumber).toBe(1);
    });

    it("returns empty when ID lookup fails", () => {
      setupDefaultMocks();
      const context = makeContext({
        query: "One Piece",
        identifiers: [{ type: "mangaupdates_series", value: "999" }],
      });
      expect(searchForManga(context)).toEqual([]);
    });
  });

  describe("Tier 2: title search", () => {
    it("searches MangaUpdates with the parsed series title", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([onePieceSeries]);
      mockedFetchSeries.mockReturnValue(onePieceSeries);

      const context = makeContext({ query: "One Piece v01 (2010).cbz" });
      searchForManga(context);

      expect(mockedSearchSeries).toHaveBeenCalledWith("One Piece");
    });

    it("returns empty when search yields no results", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([]);

      const context = makeContext({ query: "Unknown Series v01.cbz" });
      expect(searchForManga(context)).toEqual([]);
    });

    it("filters out results that fail the Levenshtein threshold", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([
        { ...onePieceSeries, title: "A Totally Different Long Title Here" },
      ]);
      mockedFetchSeries.mockReturnValue({
        ...onePieceSeries,
        title: "A Totally Different Long Title Here",
      });

      const context = makeContext({ query: "One Piece v01.cbz" });
      expect(searchForManga(context)).toEqual([]);
    });

    it("computes confidence from Levenshtein distance", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([onePieceSeries]);
      mockedFetchSeries.mockReturnValue(onePieceSeries);

      const context = makeContext({ query: "One Piece v01.cbz" });
      const results = searchForManga(context);
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(1.0);
    });

    it("sets seriesNumber from the parsed volume number", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([onePieceSeries]);
      mockedFetchSeries.mockReturnValue(onePieceSeries);

      const context = makeContext({ query: "One Piece v07.cbz" });
      const results = searchForManga(context);
      expect(results[0].seriesNumber).toBe(7);
    });

    it("retries with the prefix when the full title yields nothing", () => {
      setupDefaultMocks();
      const demonSlayerSeries: MUSeries = {
        ...onePieceSeries,
        series_id: 456,
        title: "Demon Slayer",
      };
      mockedSearchSeries
        .mockReturnValueOnce([]) // full title: no results
        .mockReturnValueOnce([demonSlayerSeries]); // prefix: match
      mockedFetchSeries.mockReturnValue(demonSlayerSeries);

      const context = makeContext({
        query: "Demon Slayer - Kimetsu no Yaiba v01.cbz",
      });
      const results = searchForManga(context);

      expect(mockedSearchSeries).toHaveBeenNthCalledWith(
        1,
        "Demon Slayer - Kimetsu no Yaiba",
      );
      expect(mockedSearchSeries).toHaveBeenNthCalledWith(2, "Demon Slayer");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe("Demon Slayer");
    });

    it("falls back to fetching full series when no primary title matches", () => {
      // MangaUpdates search results don't include associated titles, so
      // when the primary title alone doesn't match the query, the lookup
      // must fetch the full series record (which DOES have associated
      // titles) and re-run the confidence check.
      setupDefaultMocks();
      const searchResult: MUSeries = {
        series_id: 999,
        title: "Shingeki no Kyojin", // primary title doesn't match "Attack on Titan"
      };
      const fullSeries: MUSeries = {
        ...searchResult,
        title: "Shingeki no Kyojin",
        associated: [{ title: "Attack on Titan" }, { title: "進撃の巨人" }],
        publishers: [{ publisher_name: "Kodansha USA", type: "English" }],
      };
      mockedSearchSeries.mockReturnValue([searchResult]);
      mockedFetchSeries.mockReturnValue(fullSeries);

      const context = makeContext({ query: "Attack on Titan v01.cbz" });
      const results = searchForManga(context);

      // Fetch is called once (slow path): primary-title check fails, so
      // we fetch full series to access associated titles.
      expect(mockedFetchSeries).toHaveBeenCalledWith(999);
      expect(results).toHaveLength(1);
      expect(results[0].seriesNumber).toBe(1);
      expect(results[0].confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("matches via substring when the query is contained in the candidate title", () => {
      // MangaUpdates' search returns the Japanese romaji primary title
      // (e.g., "Kekkon Suru tte, Hontou desu ka: 365 Days To The Wedding")
      // without associated titles. The query "365 Days to the Wedding" is
      // a substring of the primary title, so the substring strategy must
      // accept it even though Levenshtein distance would reject it.
      setupDefaultMocks();
      const jp365Series: MUSeries = {
        ...onePieceSeries,
        series_id: 31582516596,
        title: "Kekkon Suru tte, Hontou desu ka: 365 Days To The Wedding",
      };
      mockedSearchSeries.mockReturnValue([jp365Series]);
      mockedFetchSeries.mockReturnValue(jp365Series);

      const context = makeContext({ query: "365 Days to the Wedding v01.cbz" });
      const results = searchForManga(context);

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe(
        "Kekkon Suru tte, Hontou desu ka: 365 Days To The Wedding",
      );
      expect(results[0].seriesNumber).toBe(1);
      expect(results[0].confidence).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe("publisher scraping", () => {
    const vizVolumeData = {
      title: "One Piece, Vol. 1",
      description: "Full per-volume synopsis.",
      isbn13: "9781569319017",
      releaseDate: "2003-06-01T00:00:00Z",
      imprint: "Shonen Jump",
      url: "https://www.viz.com/manga-books/manga/one-piece-volume-1-0/product/139",
    };

    it("routes to Viz when the English publisher is Viz Media", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([onePieceSeries]);
      mockedFetchSeries.mockReturnValue(onePieceSeries);
      mockedVizSearch.mockReturnValue(vizVolumeData);

      const context = makeContext({ query: "One Piece v01.cbz" });
      const results = searchForManga(context);

      expect(mockedVizSearch).toHaveBeenCalledWith("One Piece", 1, undefined);
      expect(mockedKodanshaSearch).not.toHaveBeenCalled();
      expect(results[0].description).toBe("Full per-volume synopsis.");
      expect(results[0].imprint).toBe("Shonen Jump");
      expect(results[0].releaseDate).toBe("2003-06-01T00:00:00Z");
      expect(results[0].url).toBe(vizVolumeData.url);
      // ISBN identifier is merged in addition to mangaupdates_series.
      expect(results[0].identifiers).toEqual(
        expect.arrayContaining([
          { type: "mangaupdates_series", value: "55099564912" },
          { type: "isbn_13", value: "9781569319017" },
        ]),
      );
    });

    it("overrides the MU series cover with the publisher's per-volume cover", () => {
      // The series-level MU cover is set by seriesToMetadata; the per-
      // volume publisher cover should win in the merged result.
      setupDefaultMocks();
      const withMuCover: MUSeries = {
        ...onePieceSeries,
        image: {
          url: {
            original: "https://cdn.mangaupdates.com/image/i517997.jpg",
          },
        },
      };
      mockedSearchSeries.mockReturnValue([withMuCover]);
      mockedFetchSeries.mockReturnValue(withMuCover);
      mockedVizSearch.mockReturnValue({
        ...vizVolumeData,
        coverUrl:
          "https://dw9to29mmj727.cloudfront.net/products/1569319014.jpg",
      });

      const context = makeContext({ query: "One Piece v01.cbz" });
      const results = searchForManga(context);

      expect(results[0].coverUrl).toBe(
        "https://dw9to29mmj727.cloudfront.net/products/1569319014.jpg",
      );
    });

    it("keeps the MU series cover when the publisher scraper has no cover", () => {
      setupDefaultMocks();
      const withMuCover: MUSeries = {
        ...onePieceSeries,
        image: {
          url: { original: "https://cdn.mangaupdates.com/image/i517997.jpg" },
        },
      };
      mockedSearchSeries.mockReturnValue([withMuCover]);
      mockedFetchSeries.mockReturnValue(withMuCover);
      // vizVolumeData has no coverUrl
      mockedVizSearch.mockReturnValue(vizVolumeData);

      const context = makeContext({ query: "One Piece v01.cbz" });
      const results = searchForManga(context);

      expect(results[0].coverUrl).toBe(
        "https://cdn.mangaupdates.com/image/i517997.jpg",
      );
    });

    it("routes to Kodansha when the English publisher is Kodansha USA", () => {
      setupDefaultMocks();
      const aotSeries: MUSeries = {
        ...onePieceSeries,
        series_id: 123,
        title: "Attack on Titan",
        publishers: [{ publisher_name: "Kodansha USA", type: "English" }],
      };
      mockedSearchSeries.mockReturnValue([aotSeries]);
      mockedFetchSeries.mockReturnValue(aotSeries);
      mockedKodanshaSearch.mockReturnValue({
        description: "Kodansha synopsis.",
        isbn13: "9781612620244",
      });

      const context = makeContext({ query: "Attack on Titan v01.cbz" });
      const results = searchForManga(context);

      expect(mockedKodanshaSearch).toHaveBeenCalledWith(
        "Attack on Titan",
        1,
        undefined,
      );
      expect(mockedVizSearch).not.toHaveBeenCalled();
      expect(results[0].description).toBe("Kodansha synopsis.");
    });

    it("skips scraping entirely when the publisher has no matching scraper", () => {
      // "Yen Press" is a real publisher but we don't have a scraper for it.
      // Rather than wastefully pinging Viz and Kodansha, we should return
      // series-level metadata only.
      setupDefaultMocks();
      const yenPressSeries: MUSeries = {
        ...onePieceSeries,
        publishers: [{ publisher_name: "Yen Press", type: "English" }],
      };
      mockedSearchSeries.mockReturnValue([yenPressSeries]);
      mockedFetchSeries.mockReturnValue(yenPressSeries);

      const context = makeContext({ query: "One Piece v01.cbz" });
      const results = searchForManga(context);

      expect(mockedVizSearch).not.toHaveBeenCalled();
      expect(mockedKodanshaSearch).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("One Piece");
      // No per-volume scrape happened, but series-level fields are still
      // returned (including the English publisher picked from MU).
      expect(results[0].publisher).toBe("Yen Press");
    });

    it("skips defunct and expired publishers", () => {
      // MangaUpdates lists Fruits Basket with three English publishers.
      // Chuang Yi and TokyoPop are marked Defunct/Expired and should be
      // skipped entirely — only Yen Press is considered. Since we have no
      // Yen Press scraper, no scrape should happen.
      setupDefaultMocks();
      const fruitsBasket: MUSeries = {
        ...onePieceSeries,
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
      mockedSearchSeries.mockReturnValue([fruitsBasket]);
      mockedFetchSeries.mockReturnValue(fruitsBasket);

      const context = makeContext({ query: "Fruits Basket v01.cbz" });
      searchForManga(context);

      expect(mockedVizSearch).not.toHaveBeenCalled();
      expect(mockedKodanshaSearch).not.toHaveBeenCalled();
    });

    it("tries all scrapers blindly when there is no English publisher", () => {
      // With no publisher info we have nothing to route on, so we fall
      // back to trying every registered scraper in order.
      setupDefaultMocks();
      const orphanSeries: MUSeries = {
        ...onePieceSeries,
        publishers: [{ publisher_name: "Shueisha", type: "Original" }],
      };
      mockedSearchSeries.mockReturnValue([orphanSeries]);
      mockedFetchSeries.mockReturnValue(orphanSeries);
      mockedVizSearch.mockReturnValue(null);
      mockedKodanshaSearch.mockReturnValue(vizVolumeData);

      const context = makeContext({ query: "One Piece v01.cbz" });
      const results = searchForManga(context);

      expect(mockedVizSearch).toHaveBeenCalled();
      expect(mockedKodanshaSearch).toHaveBeenCalled();
      expect(results[0].description).toBe("Full per-volume synopsis.");
    });

    it("prefers a publisher whose notes mention the parsed edition", () => {
      // Fruits Basket Collector's Edition — Yen Press notes mention
      // "Collector's Edition" and should be tried first. We give it a
      // synthetic Yen Press scraper via the Viz mock for test simplicity.
      setupDefaultMocks();
      mockedVizMatch.mockImplementation((p: string) => /yen press/i.test(p));
      const fruitsBasket: MUSeries = {
        ...onePieceSeries,
        title: "Fruits Basket",
        publishers: [
          {
            publisher_name: "TokyoPop",
            type: "English",
            notes: "23 Vols - Complete",
          },
          {
            publisher_name: "Yen Press",
            type: "English",
            notes: "12 Collector's Edition Vols - Complete",
          },
        ],
      };
      mockedSearchSeries.mockReturnValue([fruitsBasket]);
      mockedFetchSeries.mockReturnValue(fruitsBasket);
      mockedVizSearch.mockReturnValue(vizVolumeData);

      const context = makeContext({
        query: "Fruits Basket Collector's Edition v01.cbz",
      });
      searchForManga(context);

      expect(mockedVizSearch).toHaveBeenCalledWith(
        "Fruits Basket",
        1,
        "Collector's Edition",
      );
    });

    it("returns series-level metadata when no scraper finds the volume", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([onePieceSeries]);
      mockedFetchSeries.mockReturnValue(onePieceSeries);
      mockedVizSearch.mockReturnValue(null);

      const context = makeContext({ query: "One Piece v01.cbz" });
      const results = searchForManga(context);

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("One Piece");
      expect(results[0].seriesNumber).toBe(1);
      expect(results[0].description).toContain("Monkey D. Luffy");
    });

    it("skips scraping when no volume number could be parsed", () => {
      setupDefaultMocks();
      mockedSearchSeries.mockReturnValue([onePieceSeries]);
      mockedFetchSeries.mockReturnValue(onePieceSeries);

      const context = makeContext({ query: "One Piece" });
      const results = searchForManga(context);

      expect(mockedVizSearch).not.toHaveBeenCalled();
      expect(mockedKodanshaSearch).not.toHaveBeenCalled();
      expect(results[0].title).toBe("One Piece");
    });

    it("passes the edition variant to the scraper", () => {
      setupDefaultMocks();
      const fruitsBasketSeries: MUSeries = {
        ...onePieceSeries,
        series_id: 789,
        title: "Fruits Basket",
      };
      mockedSearchSeries.mockReturnValue([fruitsBasketSeries]);
      mockedFetchSeries.mockReturnValue(fruitsBasketSeries);
      mockedVizSearch.mockReturnValue(vizVolumeData);

      const context = makeContext({
        query: "Fruits Basket Collector's Edition v01 (2016).cbz",
      });
      searchForManga(context);

      expect(mockedVizSearch).toHaveBeenCalledWith(
        "Fruits Basket",
        1,
        "Collector's Edition",
      );
    });
  });
});
