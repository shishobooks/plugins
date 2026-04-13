/**
 * Per-volume metadata pulled from a publisher's product page.
 * All fields are optional — the scraper returns whatever it could extract.
 */
export interface VolumeMetadata {
  /** Full volume title (e.g., "One Piece, Vol. 1"). */
  title?: string;
  /** Volume subtitle (e.g., "Romance Dawn"). */
  subtitle?: string;
  /** Per-volume synopsis. */
  description?: string;
  /** ISO 8601 date string. */
  releaseDate?: string;
  /** ISBN-13. When multiple ISBNs exist, prefer the ebook variant. */
  isbn13?: string;
  /** ISBN-10. When multiple ISBNs exist, prefer the ebook variant. */
  isbn10?: string;
  /** Publisher imprint (e.g., "Shonen Jump" on Viz). */
  imprint?: string;
  /** Publisher product page URL. */
  url?: string;
}

/**
 * Interface implemented by every publisher scraper module.
 *
 * Each scraper is a self-contained unit. To add a new publisher, create a
 * new module under `publishers/` that implements this interface, then
 * register it in the scraper registry in `lookup.ts`.
 */
export interface PublisherScraper {
  /** Human-readable name (e.g., "Viz Media"). */
  readonly name: string;

  /**
   * Return true if the given MangaUpdates publisher name belongs to this
   * scraper (case-insensitive substring match is typical).
   */
  matchPublisher(publisherName: string): boolean;

  /**
   * Look up per-volume metadata for a specific volume of a series.
   * Returns null if the volume can't be found or any error occurs.
   * Must not throw — always return null on failure.
   */
  searchVolume(
    seriesTitle: string,
    volumeNumber: number,
    edition?: string,
  ): VolumeMetadata | null;
}
