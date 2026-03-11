import {
  decodeHTMLEntities,
  extractDescription,
  extractGenres,
  extractPublicationInfo,
  extractSchemaOrg,
  extractSeries,
  parseBookPage,
  stripHTML,
} from "../parsing";
import { describe, expect, it } from "vitest";

describe("extractSchemaOrg", () => {
  it("extracts valid Book JSON-LD", () => {
    const html = `
      <html>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Book",
        "name": "The Name of the Wind (The Kingkiller Chronicle, #1)",
        "image": "https://m.media-amazon.com/images/books/186074.jpg",
        "bookFormat": "Hardcover",
        "numberOfPages": 662,
        "inLanguage": "English",
        "isbn": "9780756404079",
        "author": [
          {"@type": "Person", "name": "Patrick Rothfuss", "url": "https://www.goodreads.com/author/show/108424"}
        ]
      }
      </script>
      </html>
    `;

    const result = extractSchemaOrg(html);
    expect(result).not.toBeNull();
    expect(result!.name).toBe(
      "The Name of the Wind (The Kingkiller Chronicle, #1)",
    );
    expect(result!.isbn).toBe("9780756404079");
    expect(result!.image).toBe(
      "https://m.media-amazon.com/images/books/186074.jpg",
    );
    expect(result!.numberOfPages).toBe(662);
    expect(result!.author).toEqual([
      {
        name: "Patrick Rothfuss",
        url: "https://www.goodreads.com/author/show/108424",
      },
    ]);
  });

  it("handles single author (not array)", () => {
    const html = `
      <script type="application/ld+json">
      {"@type": "Book", "name": "Test", "author": {"@type": "Person", "name": "Author One", "url": "/author/1"}}
      </script>
    `;

    const result = extractSchemaOrg(html);
    expect(result!.author).toEqual([{ name: "Author One", url: "/author/1" }]);
  });

  it("returns null when no JSON-LD found", () => {
    expect(
      extractSchemaOrg("<html><body>No JSON here</body></html>"),
    ).toBeNull();
  });

  it("returns null for non-Book type", () => {
    const html = `
      <script type="application/ld+json">
      {"@type": "Organization", "name": "Goodreads"}
      </script>
    `;

    expect(extractSchemaOrg(html)).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    const html = `
      <script type="application/ld+json">
      {invalid json
      </script>
    `;

    expect(extractSchemaOrg(html)).toBeNull();
  });

  it("handles missing optional fields", () => {
    const html = `
      <script type="application/ld+json">
      {"@type": "Book", "name": "Minimal Book"}
      </script>
    `;

    const result = extractSchemaOrg(html);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Minimal Book");
    expect(result!.isbn).toBeUndefined();
    expect(result!.author).toBeUndefined();
    expect(result!.image).toBeUndefined();
  });
});

describe("extractSeries", () => {
  it("extracts series from JSON-LD title with (#N)", () => {
    const schemaOrg = {
      name: "The Name of the Wind (The Kingkiller Chronicle, #1)",
    };

    const result = extractSeries("", schemaOrg);
    expect(result.series).toBe("The Kingkiller Chronicle");
    expect(result.seriesNumber).toBe(1);
  });

  it("handles decimal series numbers", () => {
    const schemaOrg = {
      name: "Some Book (A Series, #2.5)",
    };

    const result = extractSeries("", schemaOrg);
    expect(result.series).toBe("A Series");
    expect(result.seriesNumber).toBe(2.5);
  });

  it("extracts series from HTML link", () => {
    const html = `
      <div>
        <a href="/series/41526-the-kingkiller-chronicle">The Kingkiller Chronicle</a> #1
      </div>
    `;

    const result = extractSeries(html, null);
    expect(result.series).toBe("The Kingkiller Chronicle");
    expect(result.seriesNumber).toBe(1);
  });

  it("prefers JSON-LD title over HTML link", () => {
    const html = `<a href="/series/123">HTML Series</a> #2`;
    const schemaOrg = { name: "Title (JSON Series, #1)" };

    const result = extractSeries(html, schemaOrg);
    expect(result.series).toBe("JSON Series");
    expect(result.seriesNumber).toBe(1);
  });

  it("returns null when no series found", () => {
    const result = extractSeries("<html><body>No series</body></html>", null);
    expect(result.series).toBeNull();
    expect(result.seriesNumber).toBeNull();
  });

  it("returns null when JSON-LD title has no series suffix", () => {
    const schemaOrg = { name: "The Hobbit, or There and Back Again" };

    const result = extractSeries("", schemaOrg);
    expect(result.series).toBeNull();
  });
});

describe("extractGenres", () => {
  it("extracts genres from genre links", () => {
    const html = `
      <a href="/genres/fantasy">Fantasy</a>
      <a href="/genres/fiction">Fiction</a>
      <a href="/genres/adventure">Adventure</a>
    `;

    const result = extractGenres(html);
    expect(result).toEqual(["Fantasy", "Fiction", "Adventure"]);
  });

  it("deduplicates genres (case-insensitive)", () => {
    const html = `
      <a href="/genres/fantasy">Fantasy</a>
      <a href="/genres/fantasy">fantasy</a>
      <a href="/genres/fiction">Fiction</a>
    `;

    const result = extractGenres(html);
    expect(result).toEqual(["Fantasy", "Fiction"]);
  });

  it("returns empty array when no genre links found", () => {
    expect(extractGenres("<html><body>No genres</body></html>")).toEqual([]);
  });

  it("handles hyphenated genre slugs", () => {
    const html = `
      <a href="/genres/science-fiction">Science Fiction</a>
      <a href="/genres/high-fantasy">High Fantasy</a>
    `;

    const result = extractGenres(html);
    expect(result).toEqual(["Science Fiction", "High Fantasy"]);
  });
});

describe("extractDescription", () => {
  it("extracts from og:description meta tag", () => {
    const html = `
      <meta property="og:description" content="A great book about hobbits.">
    `;

    expect(extractDescription(html)).toBe("A great book about hobbits.");
  });

  it("handles reversed attribute order", () => {
    const html = `
      <meta content="Reversed order description." property="og:description">
    `;

    expect(extractDescription(html)).toBe("Reversed order description.");
  });

  it("falls back to twitter:description", () => {
    const html = `
      <meta name="twitter:description" content="Twitter description.">
    `;

    expect(extractDescription(html)).toBe("Twitter description.");
  });

  it("decodes HTML entities", () => {
    const html = `
      <meta property="og:description" content="It&apos;s a &quot;great&quot; book &amp; more.">
    `;

    expect(extractDescription(html)).toBe(`It's a "great" book & more.`);
  });

  it("returns null when no description found", () => {
    expect(extractDescription("<html><body></body></html>")).toBeNull();
  });
});

describe("extractPublicationInfo", () => {
  it("extracts 'First published' date", () => {
    const html = `<p>First published September 21, 1937</p>`;

    const result = extractPublicationInfo(html);
    expect(result.publishDate).toBe("September 21, 1937");
  });

  it("extracts 'Published' date and publisher", () => {
    const html = `<p>Published March 27, 2007 by DAW Books\n</p>`;

    const result = extractPublicationInfo(html);
    expect(result.publishDate).toBe("March 27, 2007");
    expect(result.publisher).toBe("DAW Books");
  });

  it("prefers 'First published' over 'Published'", () => {
    const html = `
      <p>First published September 21, 1937</p>
      <p>Published January 1, 1998 by Collins\n</p>
    `;

    const result = extractPublicationInfo(html);
    expect(result.publishDate).toBe("September 21, 1937");
    expect(result.publisher).toBe("Collins");
  });

  it("returns nulls when no publication info found", () => {
    const result = extractPublicationInfo("<html><body></body></html>");
    expect(result.publishDate).toBeNull();
    expect(result.publisher).toBeNull();
  });
});

describe("parseBookPage", () => {
  it("combines all extraction results", () => {
    const html = `
      <html>
      <meta property="og:description" content="A fantasy novel.">
      <script type="application/ld+json">
      {
        "@type": "Book",
        "name": "The Name of the Wind (The Kingkiller Chronicle, #1)",
        "isbn": "9780756404079",
        "image": "https://m.media-amazon.com/images/books/186074.jpg",
        "author": [{"@type": "Person", "name": "Patrick Rothfuss", "url": "/author/108424"}]
      }
      </script>
      <a href="/genres/fantasy">Fantasy</a>
      <a href="/genres/fiction">Fiction</a>
      <p>First published March 27, 2007</p>
      <p>Published March 27, 2007 by DAW Books
      </p>
      </html>
    `;

    const result = parseBookPage(html);
    expect(result.schemaOrg).not.toBeNull();
    expect(result.schemaOrg!.isbn).toBe("9780756404079");
    expect(result.description).toBe("A fantasy novel.");
    expect(result.series).toBe("The Kingkiller Chronicle");
    expect(result.seriesNumber).toBe(1);
    expect(result.genres).toEqual(["Fantasy", "Fiction"]);
    expect(result.publishDate).toBe("March 27, 2007");
    expect(result.publisher).toBe("DAW Books");
  });
});

describe("decodeHTMLEntities", () => {
  it("decodes all common entities", () => {
    expect(decodeHTMLEntities("&amp;&lt;&gt;&quot;&#39;&#x27;&apos;")).toBe(
      `&<>"'''`,
    );
  });

  it("leaves plain text unchanged", () => {
    expect(decodeHTMLEntities("Hello world")).toBe("Hello world");
  });
});

describe("stripHTML", () => {
  it("removes HTML tags", () => {
    expect(stripHTML("<b>Bold</b> and <i>italic</i>")).toBe("Bold and italic");
  });

  it("decodes HTML entities after stripping tags", () => {
    expect(stripHTML("It&apos;s a <b>great</b> book &amp; more")).toBe(
      "It's a great book & more",
    );
  });

  it("trims whitespace", () => {
    expect(stripHTML("  <p>text</p>  ")).toBe("text");
  });

  it("handles empty input", () => {
    expect(stripHTML("")).toBe("");
  });
});
