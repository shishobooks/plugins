import { lookupByProviderData, searchForBooks } from "./lookup";
import { toMetadata } from "./mapping";
import type { GRProviderData } from "./types";
import type {
  EnrichContext,
  EnrichmentResult,
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

      const providerData = context.selectedResult as GRProviderData;
      if (!providerData?.bookId) {
        shisho.log.warn("No provider data available for enrichment");
        return { modified: false };
      }

      const result = lookupByProviderData(providerData);
      if (!result) {
        shisho.log.info("Could not complete lookup for enrichment");
        return { modified: false };
      }

      shisho.log.info(`Enriching with: ${result.autocomplete.title}`);
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
