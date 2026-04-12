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
  });

  describe("publisher scraping", () => {
    const vizVolumeData = {
      title: "One Piece, Vol. 1",
      description: "Full per-volume synopsis.",
      isbn13: "9781569319017",
      releaseDate: "2003-06-01T00:00:00Z",
      pageCount: 216,
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
      expect(results[0].pageCount).toBe(216);
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

    it("falls back through all scrapers when publisher is unmatched", () => {
      setupDefaultMocks();
      const mysterySeries: MUSeries = {
        ...onePieceSeries,
        publishers: [
          { publisher_name: "Some Other Publisher", type: "English" },
        ],
      };
      mockedSearchSeries.mockReturnValue([mysterySeries]);
      mockedFetchSeries.mockReturnValue(mysterySeries);
      mockedVizSearch.mockReturnValue(null);
      mockedKodanshaSearch.mockReturnValue(vizVolumeData);

      const context = makeContext({ query: "One Piece v01.cbz" });
      const results = searchForManga(context);

      expect(mockedVizSearch).toHaveBeenCalled();
      expect(mockedKodanshaSearch).toHaveBeenCalled();
      expect(results[0].description).toBe("Full per-volume synopsis.");
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
      // No per-volume fields from scraper.
      expect(results[0].pageCount).toBeUndefined();
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
