import {
  levenshteinDistance,
  normalizeForComparison,
  parseMonth,
} from "../index";
import { describe, expect, it } from "vitest";

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
  });

  it("returns length of other string when one is empty", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });

  it("returns 0 for two empty strings", () => {
    expect(levenshteinDistance("", "")).toBe(0);
  });

  it("handles single character differences", () => {
    expect(levenshteinDistance("cat", "bat")).toBe(1);
    expect(levenshteinDistance("cat", "cats")).toBe(1);
    expect(levenshteinDistance("cat", "ca")).toBe(1);
  });

  it("handles multiple differences", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });

  it("is symmetric", () => {
    expect(levenshteinDistance("abc", "xyz")).toBe(
      levenshteinDistance("xyz", "abc"),
    );
  });

  it("handles unicode characters", () => {
    expect(levenshteinDistance("café", "cafe")).toBe(1);
  });
});

describe("normalizeForComparison", () => {
  it("lowercases text", () => {
    expect(normalizeForComparison("Hello World")).toBe("hello world");
  });

  it("removes punctuation", () => {
    expect(normalizeForComparison("Hello, World!")).toBe("hello world");
  });

  it("collapses whitespace", () => {
    expect(normalizeForComparison("hello   world")).toBe("hello world");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeForComparison("  hello  ")).toBe("hello");
  });

  it("handles combined transformations", () => {
    expect(
      normalizeForComparison("  The Hobbit: An Unexpected Journey!  "),
    ).toBe("the hobbit an unexpected journey");
  });

  it("handles empty string", () => {
    expect(normalizeForComparison("")).toBe("");
  });

  it("preserves underscores (word characters)", () => {
    expect(normalizeForComparison("hello_world")).toBe("hello_world");
  });
});

describe("parseMonth", () => {
  it("parses full month names", () => {
    expect(parseMonth("January")).toBe("01");
    expect(parseMonth("February")).toBe("02");
    expect(parseMonth("March")).toBe("03");
    expect(parseMonth("April")).toBe("04");
    expect(parseMonth("May")).toBe("05");
    expect(parseMonth("June")).toBe("06");
    expect(parseMonth("July")).toBe("07");
    expect(parseMonth("August")).toBe("08");
    expect(parseMonth("September")).toBe("09");
    expect(parseMonth("October")).toBe("10");
    expect(parseMonth("November")).toBe("11");
    expect(parseMonth("December")).toBe("12");
  });

  it("parses standard 3-letter abbreviations", () => {
    expect(parseMonth("Jan")).toBe("01");
    expect(parseMonth("Feb")).toBe("02");
    expect(parseMonth("Mar")).toBe("03");
    expect(parseMonth("Apr")).toBe("04");
    expect(parseMonth("Jun")).toBe("06");
    expect(parseMonth("Jul")).toBe("07");
    expect(parseMonth("Aug")).toBe("08");
    expect(parseMonth("Sep")).toBe("09");
    expect(parseMonth("Oct")).toBe("10");
    expect(parseMonth("Nov")).toBe("11");
    expect(parseMonth("Dec")).toBe("12");
  });

  it("parses Sept abbreviation", () => {
    expect(parseMonth("Sept")).toBe("09");
  });

  it("is case-insensitive", () => {
    expect(parseMonth("january")).toBe("01");
    expect(parseMonth("DECEMBER")).toBe("12");
    expect(parseMonth("sEpT")).toBe("09");
  });

  it("returns undefined for invalid input", () => {
    expect(parseMonth("notamonth")).toBeUndefined();
    expect(parseMonth("")).toBeUndefined();
  });
});
