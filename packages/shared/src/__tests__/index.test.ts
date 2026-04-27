import {
  isbn10To13,
  isbnsMatch,
  levenshteinDistance,
  normalizeForComparison,
  normalizeIsbn,
  parseMonth,
  slugify,
  stripHTML,
  stripSubtitle,
  titleMatchConfidence,
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

describe("slugify", () => {
  it("lowercases and hyphenates a plain title", () => {
    expect(slugify("Monster Musume")).toBe("monster-musume");
  });

  it("collapses numeric separators to hyphens", () => {
    expect(slugify("2.5 Dimensional Seduction")).toBe(
      "2-5-dimensional-seduction",
    );
  });

  it("drops ASCII apostrophes", () => {
    expect(slugify("Rozen Maiden Collector's Edition")).toBe(
      "rozen-maiden-collectors-edition",
    );
  });

  it("drops Unicode right-single-quote (U+2019)", () => {
    expect(slugify("Rozen Maiden Collector\u2019s Edition")).toBe(
      "rozen-maiden-collectors-edition",
    );
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  !Hello World!  ")).toBe("hello-world");
  });

  it("returns empty string for punctuation-only input", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("stripHTML", () => {
  it("removes HTML tags", () => {
    expect(stripHTML("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("converts <br> tags to newlines", () => {
    expect(stripHTML("line one<br />line two")).toBe("line one\nline two");
    expect(stripHTML("line one<br/>line two")).toBe("line one\nline two");
    expect(stripHTML("line one<br>line two")).toBe("line one\nline two");
  });

  it("converts </p><p> boundaries to double newlines", () => {
    expect(stripHTML("<p>First</p><p>Second</p>")).toBe("First\n\nSecond");
  });

  it("inserts paragraph break for standalone </p> followed by other blocks", () => {
    expect(stripHTML("<p>First</p><div>Aside</div><p>Last</p>")).toBe(
      "First\n\nAside\n\nLast",
    );
  });

  it("inserts newlines between <li> items", () => {
    expect(stripHTML("<ul><li>One</li><li>Two</li><li>Three</li></ul>")).toBe(
      "One\nTwo\nThree",
    );
  });

  it("handles tags with attributes", () => {
    expect(stripHTML('<p class="x">A</p><li data-y="1">B</li>')).toBe("A\n\nB");
  });

  it("handles paragraph break when next <p> has attributes", () => {
    expect(stripHTML('<p>A</p><p class="y">B</p>')).toBe("A\n\nB");
  });

  it("strips non-breaking-space whitespace before newlines", () => {
    expect(stripHTML("Line one&nbsp;<br />Line two")).toBe(
      "Line one\nLine two",
    );
  });

  it("inserts paragraph break after headings", () => {
    expect(stripHTML("<h2>Title</h2>Body text")).toBe("Title\n\nBody text");
  });

  it("collapses runs of 3+ newlines to a paragraph break", () => {
    expect(stripHTML("<p>One</p><br /><br /><p>Two</p>")).toBe("One\n\nTwo");
  });

  it("treats <hr> as a section break", () => {
    expect(stripHTML("Section1<hr>Section2")).toBe("Section1\n\nSection2");
    expect(stripHTML("Section1<hr />Section2")).toBe("Section1\n\nSection2");
  });

  it("inserts paragraph breaks for sectioning block tags", () => {
    expect(
      stripHTML(
        "<section>One</section><article>Two</article><aside>Three</aside>",
      ),
    ).toBe("One\n\nTwo\n\nThree");
  });

  it("removes <script> and <style> blocks including their bodies", () => {
    expect(stripHTML("<script>alert(1)</script>Hi")).toBe("Hi");
    expect(stripHTML("Before<style>body{color:red}</style>After")).toBe(
      "BeforeAfter",
    );
    expect(
      stripHTML('<script type="text/javascript">var x = 1;</script>Body'),
    ).toBe("Body");
  });

  it("decodes named HTML entities", () => {
    expect(stripHTML("one &amp; two")).toBe("one & two");
    expect(stripHTML("It&apos;s &quot;great&quot;")).toBe('It\'s "great"');
    expect(stripHTML("a &lt; b &gt; c")).toBe("a < b > c");
  });

  it("decodes decimal numeric entities", () => {
    expect(stripHTML("&#169; 2025")).toBe("© 2025");
    expect(stripHTML("smart&#8217;s")).toBe("smart\u2019s");
  });

  it("decodes hexadecimal numeric entities", () => {
    expect(stripHTML("&#xA9; 2025")).toBe("© 2025");
    expect(stripHTML("&#x2019;s")).toBe("\u2019s");
  });

  it("handles empty and falsy input", () => {
    expect(stripHTML("")).toBe("");
  });

  it("handles plain text", () => {
    expect(stripHTML("no tags here")).toBe("no tags here");
  });

  it("trims whitespace", () => {
    expect(stripHTML("  <p>text</p>  ")).toBe("text");
  });

  it("collapses source-formatting newlines inside inline tags to a single space", () => {
    // Goodreads' description HTML for /book/show/59498901 has italicized
    // phrases wrapped like <strong>\n  <em>Good Inside</em>\n</strong> —
    // browsers collapse those literal newlines to a space, but a naive
    // tag-strip leaves the \n in place and turns each italic phrase into
    // its own line. Make sure we match browser whitespace handling.
    expect(
      stripHTML(
        "Eve Rodsky, <strong>\n  <em>New York Times</em>\n</strong> bestselling author",
      ),
    ).toBe("Eve Rodsky, New York Times bestselling author");
  });

  it("preserves explicit <br> break next to source-formatting whitespace", () => {
    expect(stripHTML("Para one.<br />\n  <strong>Para two.</strong>")).toBe(
      "Para one.\nPara two.",
    );
  });
});

describe("stripSubtitle", () => {
  it("cuts at colon", () => {
    expect(stripSubtitle("Yesteryear: A GMA Book Club Pick")).toBe(
      "Yesteryear",
    );
  });

  it("cuts at em-dash", () => {
    expect(stripSubtitle("Title — Subtitle")).toBe("Title");
  });

  it("cuts at en-dash", () => {
    expect(stripSubtitle("Title – Subtitle")).toBe("Title");
  });

  it("returns input unchanged when no delimiter present", () => {
    expect(stripSubtitle("Yesteryear")).toBe("Yesteryear");
  });

  it("trims trailing whitespace", () => {
    expect(stripSubtitle("Title : Subtitle")).toBe("Title");
  });
});

describe("titleMatchConfidence", () => {
  it("returns 1.0 for identical titles", () => {
    expect(titleMatchConfidence("The Hobbit", "The Hobbit")).toBe(1);
  });

  it("returns 1.0 when query matches title minus subtitle", () => {
    expect(
      titleMatchConfidence("Yesteryear", "Yesteryear: A GMA Book Club Pick"),
    ).toBe(1);
  });

  it("returns 1.0 when title matches query minus subtitle", () => {
    expect(
      titleMatchConfidence("Yesteryear: A GMA Book Club Pick", "Yesteryear"),
    ).toBe(1);
  });

  it("returns lower confidence for unrelated titles", () => {
    expect(
      titleMatchConfidence("The Hobbit", "Pride and Prejudice"),
    ).toBeLessThan(0.5);
  });

  it("is tolerant of case and punctuation differences", () => {
    expect(titleMatchConfidence("the hobbit!", "The Hobbit")).toBe(1);
  });
});

describe("normalizeIsbn", () => {
  it("strips dashes and spaces from ISBN-13", () => {
    expect(normalizeIsbn("978-0-261-10221-7")).toBe("9780261102217");
    expect(normalizeIsbn("978 0 261 10221 7")).toBe("9780261102217");
  });

  it("strips arbitrary punctuation", () => {
    expect(normalizeIsbn("ISBN: 978.0.261.10221.7")).toBe("9780261102217");
  });

  it("uppercases ISBN-10 X checksum", () => {
    expect(normalizeIsbn("043942089x")).toBe("043942089X");
  });

  it("returns empty string for non-ISBN input", () => {
    expect(normalizeIsbn("1234")).toBe("");
    expect(normalizeIsbn("")).toBe("");
    expect(normalizeIsbn("not an isbn")).toBe("");
    expect(normalizeIsbn("123456789012345")).toBe("");
  });

  it("rejects ISBN-13s with an invalid check digit", () => {
    // Correct checksum for 978026110221 is 7, not 9.
    expect(normalizeIsbn("9780261102219")).toBe("");
    // All-nines has the wrong checksum (correct would be 4, not 9).
    expect(normalizeIsbn("9999999999999")).toBe("");
  });

  it("rejects ISBN-10s with an invalid check digit", () => {
    // Correct checksum for 026110221 is 4, not 5.
    expect(normalizeIsbn("0261102215")).toBe("");
  });
});

describe("isbn10To13", () => {
  it("converts ISBN-10 to ISBN-13 with correct checksum", () => {
    expect(isbn10To13("0261102214")).toBe("9780261102217");
    expect(isbn10To13("043942089X")).toBe("9780439420891");
  });

  it("accepts hyphenated ISBN-10", () => {
    expect(isbn10To13("0-261-10221-4")).toBe("9780261102217");
  });

  it("returns empty for non-ISBN-10 input", () => {
    expect(isbn10To13("9780261102217")).toBe("");
    expect(isbn10To13("not-isbn")).toBe("");
  });
});

describe("isbnsMatch", () => {
  it("matches identical ISBN-13s", () => {
    expect(isbnsMatch("9780261102217", "9780261102217")).toBe(true);
  });

  it("matches ISBN-10 against its ISBN-13 equivalent", () => {
    expect(isbnsMatch("0261102214", "9780261102217")).toBe(true);
    expect(isbnsMatch("9780261102217", "0261102214")).toBe(true);
  });

  it("ignores dashes and spaces when matching", () => {
    expect(isbnsMatch("978-0-261-10221-7", "9780261102217")).toBe(true);
    expect(isbnsMatch("0-261-10221-4", "9780261102217")).toBe(true);
  });

  it("is case-insensitive for X checksum", () => {
    expect(isbnsMatch("043942089x", "043942089X")).toBe(true);
  });

  it("rejects different ISBNs", () => {
    expect(isbnsMatch("9780261102217", "9780261103214")).toBe(false);
    expect(isbnsMatch("0261102214", "9999999999999")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isbnsMatch("", "9780261102217")).toBe(false);
    expect(isbnsMatch("1234", "9780261102217")).toBe(false);
  });
});
