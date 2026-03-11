import { fetchBookPage, fetchCover, searchAutocomplete } from "../api";
import { beforeEach, describe, expect, it, vi } from "vitest";

function mockFetch(response: {
  status: number;
  statusText?: string;
  ok: boolean;
  body?: unknown;
  text?: string;
  arrayBuffer?: ArrayBuffer;
  headers?: Record<string, string>;
}) {
  vi.mocked(shisho.http.fetch).mockReturnValue({
    status: response.status,
    statusText: response.statusText ?? "",
    ok: response.ok,
    headers: response.headers ?? {},
    json: () => response.body,
    text: () => response.text ?? "",
    arrayBuffer: () => response.arrayBuffer,
  } as ReturnType<typeof shisho.http.fetch>);
}

describe("searchAutocomplete", () => {
  beforeEach(() => {
    vi.mocked(shisho.url.searchParams).mockReturnValue(
      "format=json&q=the+hobbit",
    );
  });

  it("returns parsed JSON array on success", () => {
    const results = [
      {
        bookId: "5907",
        workId: "1540236",
        title: "The Hobbit, or There and Back Again",
        bookTitleBare: "The Hobbit, or There and Back Again",
        author: { id: 656983, name: "J.R.R. Tolkien" },
      },
    ];
    mockFetch({ status: 200, ok: true, body: results });

    const result = searchAutocomplete("the hobbit");
    expect(result).toEqual(results);
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      "https://www.goodreads.com/book/auto_complete?format=json&q=the+hobbit",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 503, statusText: "Service Unavailable", ok: false });

    expect(searchAutocomplete("test")).toBeNull();
  });

  it("passes query to searchParams", () => {
    mockFetch({ status: 200, ok: true, body: [] });

    searchAutocomplete("9780756404079");
    expect(shisho.url.searchParams).toHaveBeenCalledWith({
      format: "json",
      q: "9780756404079",
    });
  });
});

describe("fetchBookPage", () => {
  it("returns HTML string on success", () => {
    const html =
      '<html><body><script type="application/ld+json">{}</script></body></html>';
    mockFetch({ status: 200, ok: true, text: html });

    const result = fetchBookPage("5907");
    expect(result).toBe(html);
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      "https://www.goodreads.com/book/show/5907",
      expect.any(Object),
    );
  });

  it("returns null on 404", () => {
    mockFetch({ status: 404, statusText: "Not Found", ok: false });

    expect(fetchBookPage("99999999")).toBeNull();
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 500, statusText: "Internal Server Error", ok: false });

    expect(fetchBookPage("5907")).toBeNull();
  });
});

describe("fetchCover", () => {
  it("returns data and MIME type from content-type header", () => {
    const buffer = new ArrayBuffer(8);
    mockFetch({
      status: 200,
      ok: true,
      arrayBuffer: buffer,
      headers: { "content-type": "image/png" },
    });

    const result = fetchCover("https://example.com/cover.png");
    expect(result).toEqual({ data: buffer, mimeType: "image/png" });
  });

  it("strips charset from content-type header", () => {
    const buffer = new ArrayBuffer(8);
    mockFetch({
      status: 200,
      ok: true,
      arrayBuffer: buffer,
      headers: { "content-type": "image/jpeg; charset=utf-8" },
    });

    const result = fetchCover("https://example.com/cover.jpg");
    expect(result!.mimeType).toBe("image/jpeg");
  });

  it("defaults to image/jpeg when no content-type header", () => {
    const buffer = new ArrayBuffer(8);
    mockFetch({ status: 200, ok: true, arrayBuffer: buffer });

    const result = fetchCover("https://example.com/cover.jpg");
    expect(result).toEqual({ data: buffer, mimeType: "image/jpeg" });
  });

  it("returns null on failure", () => {
    mockFetch({ status: 404, ok: false });

    expect(
      fetchCover("https://m.media-amazon.com/images/invalid.jpg"),
    ).toBeNull();
  });
});
