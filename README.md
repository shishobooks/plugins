# Shisho Plugins

Official plugin repository for [Shisho](https://github.com/shishobooks/shisho), a self-hosted book library manager. Plugins extend Shisho with metadata enrichment, file parsing, and more.

## Available Plugins

| Plugin                                                  | Description                                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [Open Library Enricher](plugins/open-library-enricher/) | Fetches book metadata, covers, and identifiers from [Open Library](https://openlibrary.org)'s free API          |
| [Goodreads Enricher](plugins/goodreads-enricher/)       | Fetches book metadata and covers from [Goodreads](https://www.goodreads.com) via autocomplete and page scraping |

## Repository Structure

```
plugins/
  <plugin-id>/
    manifest.json          # Declares capabilities, config schema, and metadata
    src/index.ts           # Entry point — exports a ShishoPlugin object
    src/__tests__/         # Tests (vitest)
    package.json           # Workspace-level package
    CHANGELOG.md           # Per-plugin changelog
packages/
  shared/                  # Shared utilities (string similarity, date parsing)
scripts/
  release.sh               # Per-plugin release automation
repository.json            # Plugin registry — consumed by Shisho to discover available plugins
docker-compose.yml         # Local Shisho instance for development
esbuild.config.cjs         # Build config — bundles each plugin into a single IIFE
```

This is a **Yarn workspaces monorepo**. Each plugin under `plugins/` is its own workspace.

## Development

### Prerequisites

- Node.js (see `.node-version`)
- Yarn
- Docker (for running Shisho locally)

### Getting started

```bash
yarn install
yarn build
yarn start              # Starts Shisho at http://localhost:8080 with plugins mounted
```

### Commands

```bash
yarn build              # Build all plugins to dist/
yarn build:watch        # Rebuild on file changes
yarn clean              # Remove dist/

yarn test               # Run all tests
yarn test:watch         # Run tests in watch mode

yarn lint               # Run all linters (ESLint, Prettier, TypeScript)
yarn lint:eslint        # ESLint only
yarn lint:prettier      # Prettier check only
yarn lint:types         # TypeScript type check only

yarn start              # Start Shisho via Docker with plugins mounted
```

### How it works

Plugins are written in TypeScript and bundled by esbuild into a single IIFE file (`dist/<plugin-id>/main.js`) targeting ES2020. At runtime, plugins execute inside Shisho's [goja](https://github.com/nicholasgasior/goja) JavaScript engine — there are no Node.js APIs available. Instead, plugins interact with the host through a global `shisho` object that provides logging, HTTP, filesystem, and other APIs. Types for this runtime come from `@shisho/plugin-sdk`.

### Testing

Tests live alongside source code in `src/__tests__/` and run with vitest. A global setup file (`test/setup.ts`) mocks the `shisho` runtime object since it's only available inside goja. Use `vi.mock("../api")` to mock the HTTP layer when testing higher-level modules.

```bash
yarn test               # Run once
yarn test:watch         # Watch mode
```

### Plugin anatomy

Each plugin's `manifest.json` declares its capabilities:

- **`metadataEnricher`** — what file types to handle and which metadata fields can be fetched
- **`httpAccess`** — which external domains the plugin needs to reach
- **`identifierTypes`** — custom identifier formats the plugin recognizes (e.g., Open Library Work IDs)

The `src/index.ts` entry point exports a `ShishoPlugin` object with hook implementations that Shisho calls at the appropriate time.

## Releasing

Plugins are released independently. Each plugin has its own version and changelog.

```bash
yarn release <plugin-id> <version>
yarn release <plugin-id> <version> --dry-run
```

For example:

```bash
yarn release open-library-enricher 0.2.0
yarn release open-library-enricher 0.2.0 --dry-run
```

The release script will:

1. Bump versions in `manifest.json` and `package.json`
2. Build the plugin
3. Generate a changelog from commits since the last release
4. Update `repository.json` with the new version and download URL
5. Commit, tag (`<plugin-id>@<version>`), and push

A GitHub Actions workflow then creates the GitHub Release with the plugin ZIP as an artifact.

## License

MIT
