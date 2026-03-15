import { searchForBooks } from "./lookup";
import type {
  EnrichContext,
  EnrichmentResult,
  ParsedMetadata,
  SearchContext,
  SearchResponse,
  ShishoPlugin,
} from "@shisho/plugin-types";

const plugin: ShishoPlugin = {
  metadataEnricher: {
    search(context: SearchContext): SearchResponse {
      shisho.log.info("Goodreads enricher: searching");

      const results = searchForBooks(context);
      shisho.log.info(`Found ${results.length} candidate(s)`);

      return { results };
    },

    enrich(context: EnrichContext): EnrichmentResult {
      shisho.log.info("Goodreads enricher: enriching");

      // Passthrough — metadata was built during search and attached to SearchResult.
      // context.selectedResult is the full SearchResult object.
      const selected = context.selectedResult as Record<string, unknown>;
      const metadata = selected?.metadata as ParsedMetadata | undefined;

      if (metadata) {
        shisho.log.info(
          `Applying metadata: ${metadata.title ?? "unknown title"}`,
        );
        return { modified: true, metadata };
      }

      shisho.log.warn("No metadata found in selected result");
      return { modified: false };
    },
  },
};

// Export for esbuild IIFE bundling - this becomes the return value
export default plugin;
