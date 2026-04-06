import { fetchBookPage, searchAutocomplete } from "../api";
import { beforeEach, describe, expect, it, vi } from "vitest";

function mockFetch(response: {
  status: number;
  statusText?: string;
  ok: boolean;
  body?: unknown;
  text?: string;
}) {
  vi.mocked(shisho.http.fetch).mockReturnValue({
    status: response.status,
    statusText: response.statusText ?? "",
    ok: response.ok,
    json: () => response.body,
    text: () => response.text ?? "",
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
    mockFetch({ status: 500, statusText: "Internal Server Error", ok: false });

    expect(searchAutocomplete("test")).toBeNull();
    expect(shisho.http.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 503 and succeeds", () => {
    const results = [{ bookId: "5907", title: "The Hobbit" }];
    vi.mocked(shisho.http.fetch)
      .mockReturnValueOnce({
        status: 503,
        statusText: "Service Unavailable",
        ok: false,
        json: () => null,
        text: () => "",
      } as ReturnType<typeof shisho.http.fetch>)
      .mockReturnValueOnce({
        status: 200,
        statusText: "OK",
        ok: true,
        json: () => results,
        text: () => "",
      } as ReturnType<typeof shisho.http.fetch>);

    expect(searchAutocomplete("the hobbit")).toEqual(results);
    expect(shisho.http.fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after max retries on repeated 503", () => {
    mockFetch({ status: 503, statusText: "Service Unavailable", ok: false });

    expect(searchAutocomplete("test")).toBeNull();
    expect(shisho.http.fetch).toHaveBeenCalledTimes(3);
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
    // 500 is not retryable, so only 1 attempt
    expect(shisho.http.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 503 and returns HTML on success", () => {
    const html = "<html><body>Book</body></html>";
    vi.mocked(shisho.http.fetch)
      .mockReturnValueOnce({
        status: 503,
        statusText: "Service Unavailable",
        ok: false,
        json: () => null,
        text: () => "",
      } as ReturnType<typeof shisho.http.fetch>)
      .mockReturnValueOnce({
        status: 503,
        statusText: "Service Unavailable",
        ok: false,
        json: () => null,
        text: () => "",
      } as ReturnType<typeof shisho.http.fetch>)
      .mockReturnValueOnce({
        status: 200,
        statusText: "OK",
        ok: true,
        json: () => null,
        text: () => html,
      } as ReturnType<typeof shisho.http.fetch>);

    expect(fetchBookPage("5907")).toBe(html);
    expect(shisho.http.fetch).toHaveBeenCalledTimes(3);
  });
});
