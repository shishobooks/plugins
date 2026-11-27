import plugin from "../index";
import { describe, expect, it, vi } from "vitest";

describe("metadataEnricher.search", () => {
  it("reports no results when Audnexus fails but Audible says the ASIN doesn't exist", () => {
    vi.mocked(shisho.http.fetch).mockImplementation((url: string) => {
      if (url.includes("audnex.us")) {
        throw "shisho.http.fetch: request failed: connection reset";
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as ReturnType<typeof shisho.http.fetch>;
    });

    const response = plugin.metadataEnricher!.search({
      query: "",
      identifiers: [{ type: "asin", value: "B000000000" }],
    });

    expect(response).toEqual({ results: [] });
  });

  it("reports a failure when the Audible API itself can't be reached", () => {
    vi.mocked(shisho.http.fetch).mockImplementation(() => {
      throw "shisho.http.fetch: request failed: connection reset";
    });

    expect(() =>
      plugin.metadataEnricher!.search({
        query: "",
        identifiers: [{ type: "asin", value: "B000000000" }],
      }),
    ).toThrow();
  });
});
