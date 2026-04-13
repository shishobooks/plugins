import type { PublisherScraper, VolumeMetadata } from "./types";

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
