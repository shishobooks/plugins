import type { PublisherScraper, VolumeMetadata } from "./types";

/**
 * Build the URL slug for a Yen Press series page. Lowercases, replaces runs
 * of non-alphanumeric characters with a single hyphen, and trims hyphens
 * from the ends. Apostrophes are *not* dropped first — they become hyphens
 * along with spaces, so "Fruits Basket Collector's Edition" produces
 * "fruits-basket-collector-s-edition" — matching the actual Yen Press
 * URL scheme. If an edition is provided, it's appended to the series title
 * before slugifying so editions share a series page with the base title
 * only when Yen Press itself does.
 */
export function buildSlug(seriesTitle: string, edition?: string): string {
  const base = edition ? `${seriesTitle} ${edition}` : seriesTitle;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const yenpressScraper: PublisherScraper = {
  name: "Yen Press",

  matchPublisher(publisherName: string): boolean {
    return /\byen\s+press\b/i.test(publisherName);
  },

  searchVolume(
    _seriesTitle: string,
    _volumeNumber: number,
    _edition?: string,
  ): VolumeMetadata | null {
    return null;
  },
};
