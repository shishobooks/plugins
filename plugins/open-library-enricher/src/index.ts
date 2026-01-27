import { findBook } from "./lookup";
import { toMetadata } from "./mapping";
import type {
  EnrichmentResult,
  MetadataEnricherContext,
  ShishoPlugin,
} from "@shisho/plugin-types";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- exported via esbuild IIFE globalName
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
