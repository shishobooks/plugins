import { searchForBooks } from "./lookup";
import type {
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
  },
};

// Export for esbuild IIFE bundling - this becomes the return value
export default plugin;
