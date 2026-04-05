# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
pnpm build              # Build all plugins to dist/
pnpm build:watch        # Watch mode for development
pnpm clean              # Remove dist/
pnpm start              # Start Shisho app via Docker with plugins mounted at localhost:8080

pnpm test               # Run all tests (vitest run)
pnpm test:watch         # Watch mode (vitest)

pnpm lint               # Run all linters concurrently (fails fast)
pnpm lint:eslint        # ESLint only (--max-warnings 0)
pnpm lint:prettier      # Prettier check
pnpm lint:types         # TypeScript type check (tsc --noEmit)
```

### Testing

Tests use **vitest** and live in `plugins/<plugin-id>/src/__tests__/*.test.ts`. A global setup file (`test/setup.ts`) mocks the `shisho` runtime object (`log`, `http.fetch`, `url.searchParams`) since it's injected by goja at runtime. Mocks are reset via `vi.restoreAllMocks()` in `beforeEach`. Use `vi.mock("../api")` to mock the HTTP layer when testing higher-level modules (lookup, mapping).

### Releasing a plugin

```bash
pnpm release open-library-enricher 0.2.0
pnpm release open-library-enricher 0.2.0 goodreads-enricher 0.1.0
pnpm release open-library-enricher 0.2.0 goodreads-enricher 0.1.0 --dry-run
```

This runs `scripts/release.sh` which: validates all plugins locally, then dispatches a GitHub Actions workflow that bumps versions in `manifest.json` and `package.json`, builds, generates changelogs from path-filtered commits, updates `repository.json` with SHA256 hashes, commits as `[Release] <plugin-id>@<version>[, ...]`, creates one tag per plugin, pushes, and creates a GitHub Release per tag with the ZIP artifact. The script streams the workflow logs so you can watch progress. Multiple plugins can be released in a single invocation.

## Architecture

This is a **pnpm workspaces monorepo** for Shisho application plugins. Each plugin under `plugins/` is a workspace member.

### Build pipeline

Plugins are TypeScript, bundled by esbuild (`esbuild.config.cjs`) into a single **IIFE** (`dist/<plugin-id>/main.js`) targeting **ES2020** with platform `neutral`. The IIFE exports a global `plugin` object. The build also copies `manifest.json` into the dist output. There are no Node.js APIs available at runtime — plugins run in a [goja](https://github.com/nicholasgasior/goja) JavaScript engine.

### Plugin structure

Each plugin lives in `plugins/<plugin-id>/` with:

- `manifest.json` — declares capabilities (`metadataEnricher`, `httpAccess`, `fileParser`, `inputConverter`, `outputGenerator`, etc.) and config schema
- `src/index.ts` — entry point, exports a `ShishoPlugin` object with hook implementations
- `package.json` — workspace-level package (version must match manifest)
- `CHANGELOG.md` — per-plugin changelog (used by release process)

### Version pinning

The `@shisho/plugin-sdk` version in `package.json` and the Docker image tag in `docker-compose.yml` must always be kept in sync — both track the same Shisho release. When updating one, update the other to match.

### Runtime environment

Plugins access the host via a global `shisho` object providing: `shisho.log.*`, `shisho.config.*`, `shisho.http.fetch()`, plus filesystem/archive/XML/FFmpeg APIs. Types come from `@shisho/plugin-sdk` (declared in root `tsconfig.json` via `types`).

### Release model

Per-plugin releases. Tags use format `<plugin-id>@<version>` (e.g., `open-library-enricher@0.1.0`). Each plugin has independent versioning and its own `CHANGELOG.md`. The `repository.json` at the root serves as the plugin registry, with SHA256-verified download URLs pointing to GitHub Release assets.

## Conventions

- **Commit messages**: `[Category] Description` — categories: `Feature`/`Feat`, `Fix`, `Docs`/`Doc`, `Test`/`E2E`, `CI`/`CD`, `Chore`, `Init`, `Release`
- **Unused variables**: prefix with `_` (ESLint configured to allow this)
- **Trailing commas**: required in multiline (`comma-dangle: always-multiline`)
- **Import ordering**: enforced by Prettier plugin — builtin → third-party → project (`^@/`)
