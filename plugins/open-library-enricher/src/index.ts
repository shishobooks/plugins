import { findBook } from "./lookup";
import { toMetadata } from "./mapping";
import type {
  EnrichmentResult,
  MetadataEnricherContext,
  ShishoPlugin,
} from "@shisho/plugin-types";

const plugin: ShishoPlugin = {
  metadataEnricher: {
    enrich(context: MetadataEnricherContext): EnrichmentResult {
      shisho.log.info("Open Library enricher starting");

      // Find the book using priority lookup chain
      const result = findBook(context);
      if (!result) {
        shisho.log.info("No match found in Open Library");
        return { modified: false };
      }

      // Transform to ParsedMetadata
      shisho.log.info(`Found: ${result.work.title}`);
      const metadata = toMetadata(result);

      return {
        modified: true,
        metadata,
      };
    },
  },
};

// Export for esbuild IIFE bundling - this becomes the return value
export default plugin;
