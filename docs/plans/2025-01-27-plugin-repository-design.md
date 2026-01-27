# Shisho Official Plugin Repository Design

## Overview

This document describes the design for the official Shisho plugin repository - a TypeScript monorepo that hosts, builds, and releases plugins for the Shisho book management system.

## Repository Structure

```
plugins/
├── package.json              # Workspace root with build scripts
├── tsconfig.json             # Base TypeScript config
├── esbuild.config.js         # Build configuration
├── repository.json           # Plugin registry manifest
├── docker-compose.yml        # Testing environment
├── Makefile                  # Release and build targets
├── CHANGELOG.md              # Version history
├── .node-version             # Node.js version pin
├── .gitignore
├── scripts/
│   └── release.sh            # Release automation script
├── tmp/
│   └── library/
│       └── .gitkeep          # Test library directory
├── .github/
│   └── workflows/
│       └── release.yml       # Tag-triggered release workflow
└── plugins/
    └── open-library-enricher/
        ├── package.json      # Plugin-specific deps
        ├── tsconfig.json     # Extends root config
        ├── manifest.json     # Plugin manifest
        └── src/
            └── index.ts      # Plugin entry point
```

## Build Pipeline

### TypeScript Configuration

- Target: ES2020 (goja JavaScript engine compatibility)
- Module: ESNext
- Strict mode enabled

### esbuild Configuration

```javascript
{
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'plugin',
  target: 'es2020',
  platform: 'neutral',  // No Node.js APIs
  external: [],         // Bundle everything
}
```

### Build Output

```
dist/
└── open-library-enricher/
    ├── manifest.json  # Copied from source
    └── main.js        # Bundled JavaScript
```

### Scripts

- `yarn build` - Build all plugins to `dist/`
- `yarn build:watch` - Watch mode for development
- `yarn test:docker` - Start docker-compose for testing

## Release Workflow

### Commit Convention

Bracket-style categories (matching shisho main repo):
- `[Feature]` or `[Feat]` → Features section
- `[Fix]` → Bug Fixes section
- `[Docs]` → Documentation section
- `[Test]` → Testing section
- `[CI]` → CI/CD section

### Local Release Process (`scripts/release.sh`)

1. Validate version format and git state
2. Check for uncommitted changes
3. Verify on master branch
4. Build all plugins to `dist/`
5. Create ZIP files for each plugin
6. Calculate SHA256 hashes
7. Generate changelog from commits since last tag
8. Update `repository.json` with:
   - New version entries
   - Download URLs (predictable GitHub release URLs)
   - SHA256 hashes
9. Update `CHANGELOG.md`
10. Delete `dist/` (not committed)
11. Commit: `[Release] v{version}`
12. Create annotated git tag
13. Push to origin

### GitHub Action (triggered by tag)

1. Checkout code
2. Setup Node.js (version from `.node-version`)
3. Install dependencies via Yarn
4. Build all plugins
5. Create ZIP files
6. Verify SHA256 hashes match `repository.json`
7. Create GitHub Release
8. Upload ZIP files as release assets

### Usage

```bash
make release tag=1.0.0
# or
./scripts/release.sh 1.0.0
```

## Repository Manifest

### Format (`repository.json`)

```json
{
  "repositoryVersion": 1,
  "scope": "shisho",
  "name": "Official Shisho Plugins",
  "plugins": [
    {
      "id": "open-library-enricher",
      "name": "Open Library Enricher",
      "description": "Enriches book metadata from Open Library",
      "author": "Shisho Team",
      "homepage": "https://github.com/shishobooks/plugins",
      "versions": [
        {
          "version": "0.1.0",
          "manifestVersion": 1,
          "releaseDate": "2025-01-27",
          "changelog": "Initial release",
          "downloadUrl": "https://github.com/shishobooks/plugins/releases/download/v0.1.0/open-library-enricher-0.1.0.zip",
          "sha256": "..."
        }
      ]
    }
  ]
}
```

## Testing

### Docker Compose

```yaml
services:
  shisho:
    image: ghcr.io/shishobooks/shisho:latest
    ports:
      - "8080:8080"
    volumes:
      - ./dist:/config/plugins/installed/shisho
      - ./tmp/library:/library
    environment:
      - SHISHO_LIBRARY_PATH=/library
```

### Workflow

1. `yarn build` - Build plugins to `dist/`
2. `yarn test:docker` - Start Shisho with plugins mounted
3. Access Shisho at `localhost:8080`
4. Plugin appears as installed under `shisho` scope

## First Plugin: Open Library Enricher

### Manifest

```json
{
  "manifestVersion": 1,
  "id": "open-library-enricher",
  "name": "Open Library Enricher",
  "version": "0.1.0",
  "description": "Enriches book metadata from Open Library",
  "author": "Shisho Team",
  "homepage": "https://github.com/shishobooks/plugins",
  "license": "MIT",
  "capabilities": {
    "metadataEnricher": {
      "description": "Fetches metadata from Open Library API",
      "fileTypes": ["epub", "m4b"]
    },
    "httpAccess": {
      "description": "Calls Open Library API",
      "domains": ["openlibrary.org"]
    }
  },
  "configSchema": {}
}
```

### Implementation (Dummy)

```typescript
import type { ShishoPlugin, MetadataEnricherContext, EnrichmentResult } from "@shisho/plugin-types";

const plugin: ShishoPlugin = {
  metadataEnricher: {
    enrich(context: MetadataEnricherContext): EnrichmentResult {
      shisho.log.info("Open Library enricher called");

      // TODO: Implement actual Open Library lookup
      return {
        modified: false,
      };
    },
  },
};
```

## Git Ignore Rules

```
dist/
tmp/*
!tmp/library/.gitkeep
node_modules/
```

## Dependencies

### Root Package

- `@shisho/plugin-types` (latest) - Type definitions
- `esbuild` - Bundler
- `typescript` - Compiler

### Node Version

Pinned in `.node-version` file for deterministic builds across local and CI environments.
