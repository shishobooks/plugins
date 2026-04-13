import { fetchSeries, searchSeries } from "../mangaupdates/api";
import { describe, expect, it, vi } from "vitest";

function mockFetch(response: { status: number; ok: boolean; body?: unknown }) {
  vi.mocked(shisho.http.fetch).mockReturnValue({
    status: response.status,
    statusText: response.ok ? "OK" : "Error",
    ok: response.ok,
    json: () => response.body,
    text: () => JSON.stringify(response.body ?? ""),
  } as ReturnType<typeof shisho.http.fetch>);
}

describe("searchSeries", () => {
  it("POSTs to the search endpoint with the query in the body", () => {
    mockFetch({
      status: 200,
      ok: true,
      body: {
        total_hits: 1,
        page: 1,
        per_page: 25,
        results: [
          {
            record: { series_id: 55099564912, title: "One Piece" },
          },
        ],
      },
    });

    const results = searchSeries("One Piece");

    expect(results).toHaveLength(1);
    expect(results?.[0].title).toBe("One Piece");

    const call = vi.mocked(shisho.http.fetch).mock.calls[0];
    expect(call[0]).toBe("https://api.mangaupdates.com/v1/series/search");
    expect(call[1]?.method).toBe("POST");
    expect(JSON.parse(call[1]?.body as string)).toEqual({
      search: "One Piece",
      perpage: 10,
    });
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 500, ok: false });
    expect(searchSeries("foo")).toBeNull();
  });

  it("returns null on empty query", () => {
    expect(searchSeries("")).toBeNull();
    expect(shisho.http.fetch).not.toHaveBeenCalled();
  });
});

describe("fetchSeries", () => {
  it("GETs the series detail endpoint", () => {
    mockFetch({
      status: 200,
      ok: true,
      body: { series_id: 55099564912, title: "One Piece" },
    });

    const series = fetchSeries(55099564912);

    expect(series?.title).toBe("One Piece");
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      "https://api.mangaupdates.com/v1/series/55099564912",
      expect.objectContaining({
        headers: expect.any(Object),
      }),
    );
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 404, ok: false });
    expect(fetchSeries(123)).toBeNull();
  });
});
