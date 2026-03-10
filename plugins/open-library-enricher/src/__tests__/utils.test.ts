import {
  extractOLId,
  levenshteinDistance,
  normalizeDescription,
  normalizeForComparison,
  parseOLDate,
  parseSeriesNumber,
  toTitleCase,
} from "../utils";
import { describe, expect, it } from "vitest";

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
  });

  it("returns 1 for a single edit", () => {
    expect(levenshteinDistance("cat", "car")).toBe(1);
  });

  it("handles completely different strings", () => {
    expect(levenshteinDistance("abc", "xyz")).toBe(3);
  });

  it("handles empty strings", () => {
    expect(levenshteinDistance("", "")).toBe(0);
    expect(levenshteinDistance("abc", "")).toBe(3);
    expect(levenshteinDistance("", "abc")).toBe(3);
  });

  it("handles insertions and deletions", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });
});

describe("normalizeForComparison", () => {
  it("converts to lowercase", () => {
    expect(normalizeForComparison("HELLO")).toBe("hello");
  });

  it("removes punctuation", () => {
    expect(normalizeForComparison("hello, world!")).toBe("hello world");
  });

  it("collapses whitespace", () => {
    expect(normalizeForComparison("hello   world")).toBe("hello world");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeForComparison("  hello  ")).toBe("hello");
  });

  it("handles combined normalization", () => {
    expect(normalizeForComparison("  The Lord's Ring:  A Tale  ")).toBe(
      "the lords ring a tale",
    );
  });
});

describe("toTitleCase", () => {
  it("converts basic text to title case", () => {
    expect(toTitleCase("hello world")).toBe("Hello World");
  });

  it("handles single word", () => {
    expect(toTitleCase("hello")).toBe("Hello");
  });

  it("handles already title-cased text", () => {
    expect(toTitleCase("Hello World")).toBe("Hello World");
  });

  it("lowercases uppercase text before title casing", () => {
    expect(toTitleCase("HELLO WORLD")).toBe("Hello World");
  });
});

describe("extractOLId", () => {
  it("extracts work ID from key", () => {
    expect(extractOLId("/works/OL123W")).toBe("OL123W");
  });

  it("extracts edition ID from key", () => {
    expect(extractOLId("/books/OL456M")).toBe("OL456M");
  });

  it("extracts author ID from key", () => {
    expect(extractOLId("/authors/OL789A")).toBe("OL789A");
  });

  it("returns the string itself when no slash", () => {
    expect(extractOLId("OL123W")).toBe("OL123W");
  });
});

describe("parseOLDate", () => {
  it("parses year only", () => {
    expect(parseOLDate("1954")).toBe("1954-01-01T00:00:00Z");
  });

  it("parses full month and year", () => {
    expect(parseOLDate("June 1954")).toBe("1954-06-01T00:00:00Z");
  });

  it("parses abbreviated month and year", () => {
    expect(parseOLDate("Jun 1954")).toBe("1954-06-01T00:00:00Z");
  });

  it("parses full date with full month name", () => {
    expect(parseOLDate("June 15, 1954")).toBe("1954-06-15T00:00:00Z");
  });

  it("parses full date with abbreviated month", () => {
    expect(parseOLDate("Jun 15, 1954")).toBe("1954-06-15T00:00:00Z");
  });

  it("parses full date without comma", () => {
    expect(parseOLDate("Jun 15 1954")).toBe("1954-06-15T00:00:00Z");
  });

  it("parses ISO format passthrough", () => {
    expect(parseOLDate("1954-06-15")).toBe("1954-06-15T00:00:00Z");
  });

  it("returns undefined for invalid date", () => {
    expect(parseOLDate("not a date")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseOLDate("")).toBeUndefined();
  });

  it("pads single-digit days", () => {
    expect(parseOLDate("Jun 5, 1954")).toBe("1954-06-05T00:00:00Z");
  });
});

describe("parseSeriesNumber", () => {
  it('parses "Book 2"', () => {
    expect(parseSeriesNumber("Book 2")).toBe(2);
  });

  it('parses "Vol. 3"', () => {
    expect(parseSeriesNumber("Vol. 3")).toBe(3);
  });

  it('parses "#5"', () => {
    expect(parseSeriesNumber("#5")).toBe(5);
  });

  it('parses "Part 1"', () => {
    expect(parseSeriesNumber("Part 1")).toBe(1);
  });

  it("parses trailing number", () => {
    expect(parseSeriesNumber("My Series 7")).toBe(7);
  });

  it("returns undefined when no number", () => {
    expect(parseSeriesNumber("My Series")).toBeUndefined();
  });

  it('parses "Volume 10"', () => {
    expect(parseSeriesNumber("Volume 10")).toBe(10);
  });
});

describe("normalizeDescription", () => {
  it("passes through strings", () => {
    expect(normalizeDescription("A great book")).toBe("A great book");
  });

  it("extracts value from object with value property", () => {
    expect(
      normalizeDescription({ type: "/type/text", value: "A great book" }),
    ).toBe("A great book");
  });

  it("returns undefined for undefined", () => {
    expect(normalizeDescription(undefined)).toBeUndefined();
  });

  it("handles object without type", () => {
    expect(normalizeDescription({ value: "text" })).toBe("text");
  });
});
