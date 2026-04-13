import type { MUSeries } from "./types";
import { stripHTML } from "@shisho-plugins/shared";
import type { ParsedAuthor, ParsedMetadata } from "@shisho/plugin-sdk";

/** Minimum community votes for a category to be included as a tag. */
const MIN_CATEGORY_VOTES = 2;

/**
 * Title-case ALL-CAPS words in an author name while preserving the rest.
 *
 * MangaUpdates follows the convention of writing surnames in all caps
 * (e.g., "ODA Eiichiro", "KUBO Tite") to disambiguate them from given
 * names, especially for Japanese authors where family name ordering can
 * be ambiguous. We normalize these to proper title case ("Oda Eiichiro",
 * "Kubo Tite") for display.
 *
 * Words that already mix case (e.g., "McDonald", "deGrasse") or are
 * entirely lowercase are left alone — we only transform runs of 2+
 * uppercase letters to avoid damaging intentional casing.
 */
export function titleCaseAuthorName(name: string): string {
  return name.replace(
    /\b[A-Z]{2,}\b/g,
    (word) => word[0] + word.slice(1).toLowerCase(),
  );
}

/** A live English publisher from a MangaUpdates series record. */
export interface EnglishPublisher {
  name: string;
  notes?: string;
}

/**
 * Return all English-type publishers that are not marked defunct or expired
 * in MangaUpdates' notes, ordered most-recent-first.
 *
 * MangaUpdates lists publishers in chronological order (oldest first), so
 * the current active licensor is typically the last entry. For example,
 * Fruits Basket is listed as Chuang Yi → TokyoPop → Yen Press, and Wotakoi
 * as INKR → Kodansha Comics. We reverse the array so callers can treat
 * the head as "the most likely current licensor".
 *
 * The notes field uses human-readable strings like:
 *   "Defunct / 23 Vols - Complete"
 *   "Expired / 23 Vols - Complete | 6 Ultimate Edition Vols - Incomplete"
 *   "12 Collector's Edition Vols - Complete"
 * Anything containing "Defunct" or "Expired" is dropped — these licenses
 * are dead and any product page will 404.
 */
export function getLiveEnglishPublishers(series: MUSeries): EnglishPublisher[] {
  if (!series.publishers) return [];
  return series.publishers
    .filter((p) => p.type === "English")
    .filter((p) => !/\b(defunct|expired)\b/i.test(p.notes ?? ""))
    .map((p) => ({ name: p.publisher_name, notes: p.notes }))
    .reverse();
}

/**
 * Return the name of the most recent live English publisher, or undefined.
 * Used for the top-level `publisher` metadata field when no publisher
 * scraper runs.
 */
export function pickEnglishPublisher(series: MUSeries): string | undefined {
  return getLiveEnglishPublishers(series)[0]?.name;
}

/**
 * Map an MUSeries to ParsedMetadata covering series-level fields only.
 * Per-volume fields (releaseDate, isbn, synopsis per volume)
 * are layered on top by publisher scrapers.
 */
export function seriesToMetadata(series: MUSeries): ParsedMetadata {
  const metadata: ParsedMetadata = {};

  metadata.title = series.title;
  metadata.series = series.title;

  if (series.authors && series.authors.length > 0) {
    const authors: ParsedAuthor[] = series.authors.map((a) => {
      const name = titleCaseAuthorName(a.name);
      const role =
        a.type === "Artist" ? "penciller" : a.type === "Author" ? "writer" : "";
      return role ? { name, role } : { name };
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

  // MangaUpdates hosts series cover images on its CDN. Use the original
  // (full-size) variant when present. The CBZ parser will usually pull a
  // page-embedded cover at apply time, but the enricher preview UI needs
  // something to show before the user picks a match.
  const coverUrl = series.image?.url?.original;
  if (coverUrl) {
    metadata.coverUrl = coverUrl;
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
