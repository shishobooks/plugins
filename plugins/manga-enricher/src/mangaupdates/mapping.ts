import type { MUSeries } from "./types";
import { stripHTML } from "@shisho-plugins/shared";
import type { ParsedAuthor, ParsedMetadata } from "@shisho/plugin-sdk";

/** Minimum community votes for a category to be included as a tag. */
const MIN_CATEGORY_VOTES = 2;

/**
 * Return the name of the first English-type publisher, or undefined.
 */
export function pickEnglishPublisher(series: MUSeries): string | undefined {
  return series.publishers?.find((p) => p.type === "English")?.publisher_name;
}

/**
 * Map an MUSeries to ParsedMetadata covering series-level fields only.
 * Per-volume fields (releaseDate, pageCount, isbn, synopsis per volume)
 * are layered on top by publisher scrapers.
 */
export function seriesToMetadata(series: MUSeries): ParsedMetadata {
  const metadata: ParsedMetadata = {};

  metadata.title = series.title;
  metadata.series = series.title;

  if (series.authors && series.authors.length > 0) {
    const authors: ParsedAuthor[] = series.authors.map((a) => {
      const role =
        a.type === "Artist" ? "penciller" : a.type === "Author" ? "writer" : "";
      return role ? { name: a.name, role } : { name: a.name };
    });
    metadata.authors = authors;
  }

  if (series.genres && series.genres.length > 0) {
    metadata.genres = series.genres.map((g) => g.genre);
  }

  if (series.categories && series.categories.length > 0) {
    const tags = series.categories
      .filter((c) => (c.votes ?? 0) >= MIN_CATEGORY_VOTES)
      .map((c) => c.category);
    if (tags.length > 0) metadata.tags = tags;
  }

  if (series.description) {
    metadata.description = stripHTML(series.description);
  }

  const englishPublisher = pickEnglishPublisher(series);
  if (englishPublisher) {
    metadata.publisher = englishPublisher;
  }

  if (series.url) {
    metadata.url = series.url;
  }

  metadata.language = "en";
  metadata.identifiers = [
    { type: "mangaupdates_series", value: String(series.series_id) },
  ];

  return metadata;
}
