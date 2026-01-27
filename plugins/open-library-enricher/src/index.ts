import type {
  EnrichmentResult,
  MetadataEnricherContext,
  ShishoPlugin,
} from "@shisho/plugin-types";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `plugin` is required by the Shisho plugin runtime
const plugin: ShishoPlugin = {
  metadataEnricher: {
    enrich(_context: MetadataEnricherContext): EnrichmentResult {
      shisho.log.info("Open Library enricher called");

      // TODO: Implement actual Open Library lookup
      return {
        modified: false,
      };
    },
  },
};
