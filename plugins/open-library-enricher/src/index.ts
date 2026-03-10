import { lookupByProviderData, searchForBooks } from "./lookup";
import { toMetadata } from "./mapping";
import type { OLProviderData } from "./types";
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
      shisho.log.info("Open Library enricher: searching");

      const results = searchForBooks(context);
      shisho.log.info(`Found ${results.length} candidate(s)`);

      return { results };
    },

    enrich(context: EnrichContext): EnrichmentResult {
      shisho.log.info("Open Library enricher: enriching");

      const providerData = context.selectedResult as OLProviderData;
      if (!providerData?.workId && !providerData?.editionId) {
        shisho.log.warn("No provider data available for enrichment");
        return { modified: false };
      }

      const result = lookupByProviderData(providerData);
      if (!result) {
        shisho.log.info("Could not complete lookup for enrichment");
        return { modified: false };
      }

      shisho.log.info(`Enriching with: ${result.work.title}`);
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
