import {
  fetchAuthor,
  fetchByISBN,
  fetchCover,
  fetchEdition,
  fetchWork,
  searchBooks,
} from "../api";
import { beforeEach, describe, expect, it, vi } from "vitest";

function mockFetch(response: {
  status: number;
  statusText?: string;
  ok: boolean;
  body?: unknown;
  arrayBuffer?: ArrayBuffer;
  headers?: Record<string, string>;
}) {
  vi.mocked(shisho.http.fetch).mockReturnValue({
    status: response.status,
    statusText: response.statusText ?? "",
    ok: response.ok,
    headers: response.headers ?? {},
    json: () => response.body,
    arrayBuffer: () => response.arrayBuffer,
  } as ReturnType<typeof shisho.http.fetch>);
}

describe("fetchEdition", () => {
  it("returns parsed JSON on success", () => {
    const edition = { key: "/books/OL123M", title: "Test Book" };
    mockFetch({ status: 200, ok: true, body: edition });

    const result = fetchEdition("OL123M");
    expect(result).toEqual(edition);
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      "https://openlibrary.org/books/OL123M.json",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("returns null on 404", () => {
    mockFetch({ status: 404, ok: false });

    expect(fetchEdition("OL999M")).toBeNull();
  });

  it("returns null on HTTP error", () => {
    mockFetch({ status: 500, statusText: "Internal Server Error", ok: false });

    expect(fetchEdition("OL123M")).toBeNull();
  });
});

describe("fetchWork", () => {
  it("returns parsed JSON on success", () => {
    const work = { key: "/works/OL456W", title: "Test Work" };
    mockFetch({ status: 200, ok: true, body: work });

    const result = fetchWork("OL456W");
    expect(result).toEqual(work);
  });

  it("returns null when not found", () => {
    mockFetch({ status: 404, ok: false });

    expect(fetchWork("OL999W")).toBeNull();
  });
});

describe("fetchByISBN", () => {
  it("returns edition on success", () => {
    const edition = { key: "/books/OL123M", title: "ISBN Book" };
    mockFetch({ status: 200, ok: true, body: edition });

    const result = fetchByISBN("9780123456789");
    expect(result).toEqual(edition);
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      "https://openlibrary.org/isbn/9780123456789.json",
      expect.any(Object),
    );
  });

  it("returns null when not found", () => {
    mockFetch({ status: 404, ok: false });

    expect(fetchByISBN("0000000000")).toBeNull();
  });
});

describe("fetchAuthor", () => {
  it("returns author on success", () => {
    const author = { key: "/authors/OL789A", name: "Test Author" };
    mockFetch({ status: 200, ok: true, body: author });

    const result = fetchAuthor("OL789A");
    expect(result).toEqual(author);
  });

  it("returns null when not found", () => {
    mockFetch({ status: 404, ok: false });

    expect(fetchAuthor("OL999A")).toBeNull();
  });
});

describe("searchBooks", () => {
  beforeEach(() => {
    vi.mocked(shisho.url.searchParams).mockReturnValue("title=Test&limit=5");
  });

  it("searches by title only", () => {
    const searchResult = { numFound: 1, start: 0, docs: [] };
    mockFetch({ status: 200, ok: true, body: searchResult });

    const result = searchBooks("Test");
    expect(result).toEqual(searchResult);
    expect(shisho.url.searchParams).toHaveBeenCalledWith({
      title: "Test",
      limit: 5,
    });
  });

  it("includes author in search params", () => {
    const searchResult = { numFound: 1, start: 0, docs: [] };
    mockFetch({ status: 200, ok: true, body: searchResult });

    searchBooks("Test", "Author Name");
    expect(shisho.url.searchParams).toHaveBeenCalledWith({
      title: "Test",
      author: "Author Name",
      limit: 5,
    });
  });

  it("returns null when no results", () => {
    mockFetch({ status: 404, ok: false });

    expect(searchBooks("Nonexistent")).toBeNull();
  });
});

describe("fetchCover", () => {
  it("returns data and MIME type from content-type header", () => {
    const buffer = new ArrayBuffer(8);
    mockFetch({
      status: 200,
      ok: true,
      arrayBuffer: buffer,
      headers: { "content-type": "image/jpeg" },
    });

    const result = fetchCover(12345);
    expect(result).toEqual({ data: buffer, mimeType: "image/jpeg" });
    expect(shisho.http.fetch).toHaveBeenCalledWith(
      "https://covers.openlibrary.org/b/id/12345-L.jpg",
      expect.any(Object),
    );
  });

  it("strips charset from content-type header", () => {
    const buffer = new ArrayBuffer(8);
    mockFetch({
      status: 200,
      ok: true,
      arrayBuffer: buffer,
      headers: { "content-type": "image/png; charset=utf-8" },
    });

    const result = fetchCover(12345);
    expect(result!.mimeType).toBe("image/png");
  });

  it("defaults to image/jpeg when no content-type header", () => {
    const buffer = new ArrayBuffer(8);
    mockFetch({ status: 200, ok: true, arrayBuffer: buffer });

    const result = fetchCover(12345);
    expect(result).toEqual({ data: buffer, mimeType: "image/jpeg" });
  });

  it("returns null on failure", () => {
    mockFetch({ status: 404, ok: false });

    expect(fetchCover(99999)).toBeNull();
  });
});
