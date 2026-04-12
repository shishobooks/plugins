import {
  fetchAudnexusBook,
  fetchProduct,
  getMarketplaces,
  searchProducts,
} from "../api";
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

describe("getMarketplaces", () => {
  it("parses comma-separated config value", () => {
    vi.mocked(shisho.config.get).mockReturnValue("us,uk,de");
    expect(getMarketplaces()).toEqual(["us", "uk", "de"]);
  });

  it("trims whitespace from codes", () => {
    vi.mocked(shisho.config.get).mockReturnValue("us , uk , de");
    expect(getMarketplaces()).toEqual(["us", "uk", "de"]);
  });

  it("filters out invalid marketplace codes", () => {
    vi.mocked(shisho.config.get).mockReturnValue("us,invalid,uk");
    expect(getMarketplaces()).toEqual(["us", "uk"]);
  });

  it("defaults to ['us'] when config is empty", () => {
    vi.mocked(shisho.config.get).mockReturnValue("");
    expect(getMarketplaces()).toEqual(["us"]);
  });

  it("defaults to ['us'] when config is undefined", () => {
    vi.mocked(shisho.config.get).mockReturnValue(undefined);
    expect(getMarketplaces()).toEqual(["us"]);
  });
});

describe("searchProducts", () => {
  it("returns products on success", () => {
    const products = [{ asin: "B08G9PRS1K", title: "Project Hail Mary" }];
    mockFetch({
      status: 200,
      ok: true,
      body: { products, total_results: 1 },
    });

    const result = searchProducts("us", "Project Hail Mary");
    expect(result).toEqual(products);
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      expect.stringContaining("api.audible.com/1.0/catalog/products?"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("includes author parameter when provided", () => {
    mockFetch({ status: 200, ok: true, body: { products: [] } });

    searchProducts("us", "Project Hail Mary", "Andy Weir");
    const url = vi.mocked(shisho.http.fetch).mock.calls[0][0] as string;
    expect(url).toContain("author=Andy+Weir");
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 503, ok: false });
    expect(searchProducts("us", "test")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    vi.mocked(shisho.http.fetch).mockReturnValue({
      status: 200,
      statusText: "OK",
      ok: true,
      json: () => {
        throw new Error("bad json");
      },
      text: () => "not json",
    } as unknown as ReturnType<typeof shisho.http.fetch>);

    expect(searchProducts("us", "test")).toBeNull();
  });

  it("uses correct domain for non-US marketplace", () => {
    mockFetch({ status: 200, ok: true, body: { products: [] } });

    searchProducts("uk", "test");
    const url = vi.mocked(shisho.http.fetch).mock.calls[0][0] as string;
    expect(url).toContain("api.audible.co.uk");
  });
});

describe("fetchProduct", () => {
  it("returns product on success", () => {
    const product = { asin: "B08G9PRS1K", title: "Project Hail Mary" };
    mockFetch({ status: 200, ok: true, body: { product } });

    const result = fetchProduct("us", "B08G9PRS1K");
    expect(result).toEqual(product);
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "api.audible.com/1.0/catalog/products/B08G9PRS1K?",
      ),
      expect.any(Object),
    );
  });

  it("includes category_ladders in response_groups", () => {
    mockFetch({ status: 200, ok: true, body: { product: {} } });

    fetchProduct("us", "B08G9PRS1K");
    const url = vi.mocked(shisho.http.fetch).mock.calls[0][0] as string;
    expect(url).toContain("category_ladders");
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 404, ok: false });
    expect(fetchProduct("us", "B08G9PRS1K")).toBeNull();
  });
});

describe("fetchAudnexusBook", () => {
  it("returns book on success", () => {
    const book = { asin: "B08G9PRS1K", title: "Project Hail Mary" };
    mockFetch({ status: 200, ok: true, body: book });

    const result = fetchAudnexusBook("B08G9PRS1K", "us");
    expect(result).toEqual(book);
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      "https://api.audnex.us/books/B08G9PRS1K?region=us",
      expect.any(Object),
    );
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 500, ok: false });
    expect(fetchAudnexusBook("B08G9PRS1K", "us")).toBeNull();
  });
});
