# Plugin Repository Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up a TypeScript monorepo for official Shisho plugins with build tooling, release automation, and Docker-based testing.

**Architecture:** Yarn workspaces monorepo with esbuild bundling each plugin to a single IIFE `main.js`. Local release script handles changelog generation and repository.json updates; GitHub Actions creates releases and uploads assets.

**Tech Stack:** TypeScript, esbuild, Yarn workspaces, GitHub Actions, Docker Compose

---

### Task 1: Initialize Package Structure

**Files:**
- Create: `package.json`
- Create: `.node-version`
- Create: `.gitignore`
- Create: `tmp/library/.gitkeep`

**Step 1: Create root package.json**

```json
{
  "name": "shisho-plugins",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "plugins/*"
  ],
  "scripts": {
    "build": "node esbuild.config.js",
    "build:watch": "node esbuild.config.js --watch",
    "test:docker": "docker compose up",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "@shisho/plugin-types": "latest",
    "esbuild": "^0.24.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create .node-version**

```
24
```

**Step 3: Create .gitignore**

```
# Dependencies
node_modules/

# Build output
dist/

# Temporary files
tmp/*
!tmp/library/.gitkeep

# OS files
.DS_Store

# IDE
.idea/
.vscode/
*.swp
```

**Step 4: Create tmp/library/.gitkeep**

```bash
mkdir -p tmp/library
touch tmp/library/.gitkeep
```

**Step 5: Commit**

```bash
git add package.json .node-version .gitignore tmp/library/.gitkeep
git commit -m "[Feature] Initialize package structure"
```

---

### Task 2: Configure TypeScript

**Files:**
- Create: `tsconfig.json`

**Step 1: Create root tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "noEmit": true,
    "types": ["@shisho/plugin-types"]
  },
  "exclude": ["node_modules", "dist"]
}
```

**Step 2: Commit**

```bash
git add tsconfig.json
git commit -m "[Feature] Add TypeScript configuration"
```

---

### Task 3: Configure esbuild

**Files:**
- Create: `esbuild.config.js`

**Step 1: Create esbuild.config.js**

```javascript
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const watchMode = process.argv.includes("--watch");
const pluginsDir = path.join(__dirname, "plugins");
const distDir = path.join(__dirname, "dist");

// Find all plugins (directories with manifest.json)
const plugins = fs
  .readdirSync(pluginsDir, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .filter((dirent) =>
    fs.existsSync(path.join(pluginsDir, dirent.name, "manifest.json"))
  )
  .map((dirent) => dirent.name);

if (plugins.length === 0) {
  console.log("No plugins found in plugins/ directory");
  process.exit(0);
}

console.log(`Found ${plugins.length} plugin(s): ${plugins.join(", ")}`);

// Build each plugin
async function build() {
  for (const plugin of plugins) {
    const pluginDir = path.join(pluginsDir, plugin);
    const outDir = path.join(distDir, plugin);

    // Ensure output directory exists
    fs.mkdirSync(outDir, { recursive: true });

    // Copy manifest.json
    fs.copyFileSync(
      path.join(pluginDir, "manifest.json"),
      path.join(outDir, "manifest.json")
    );

    // Build TypeScript to main.js
    const ctx = await esbuild.context({
      entryPoints: [path.join(pluginDir, "src", "index.ts")],
      bundle: true,
      format: "iife",
      globalName: "plugin",
      target: "es2020",
      platform: "neutral",
      outfile: path.join(outDir, "main.js"),
      logLevel: "info",
    });

    if (watchMode) {
      await ctx.watch();
      console.log(`Watching ${plugin}...`);
    } else {
      await ctx.rebuild();
      await ctx.dispose();
      console.log(`Built ${plugin}`);
    }
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Step 2: Commit**

```bash
git add esbuild.config.js
git commit -m "[Feature] Add esbuild configuration"
```

---

### Task 4: Create Open Library Enricher Plugin

**Files:**
- Create: `plugins/open-library-enricher/package.json`
- Create: `plugins/open-library-enricher/tsconfig.json`
- Create: `plugins/open-library-enricher/manifest.json`
- Create: `plugins/open-library-enricher/src/index.ts`

**Step 1: Create plugin package.json**

```json
{
  "name": "@shisho-plugins/open-library-enricher",
  "version": "0.1.0",
  "private": true
}
```

**Step 2: Create plugin tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "include": ["src/**/*"]
}
```

**Step 3: Create plugin manifest.json**

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

**Step 4: Create plugin src/index.ts**

```typescript
import type {
  ShishoPlugin,
  MetadataEnricherContext,
  EnrichmentResult,
} from "@shisho/plugin-types";

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

**Step 5: Create directory structure**

```bash
mkdir -p plugins/open-library-enricher/src
```

**Step 6: Commit**

```bash
git add plugins/open-library-enricher/
git commit -m "[Feature] Add Open Library enricher plugin skeleton"
```

---

### Task 5: Create Repository Manifest

**Files:**
- Create: `repository.json`

**Step 1: Create repository.json**

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
      "versions": []
    }
  ]
}
```

**Step 2: Commit**

```bash
git add repository.json
git commit -m "[Feature] Add repository manifest"
```

---

### Task 6: Create CHANGELOG

**Files:**
- Create: `CHANGELOG.md`

**Step 1: Create CHANGELOG.md**

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "[Docs] Add changelog"
```

---

### Task 7: Create Docker Compose for Testing

**Files:**
- Create: `docker-compose.yml`

**Step 1: Create docker-compose.yml**

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

**Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "[Feature] Add Docker Compose for testing"
```

---

### Task 8: Create Release Script

**Files:**
- Create: `scripts/release.sh`

**Step 1: Create scripts/release.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Release script for Shisho Plugins
# Usage: ./scripts/release.sh <version> [--dry-run]
# Example: ./scripts/release.sh 0.1.0
# Example: ./scripts/release.sh 0.1.0 --dry-run

DRY_RUN=false
VERSION=""

# Parse arguments
for arg in "$@"; do
    case "$arg" in
        --dry-run)
            DRY_RUN=true
            ;;
        *)
            if [[ -z "$VERSION" ]]; then
                VERSION="$arg"
            fi
            ;;
    esac
done

if [[ -z "$VERSION" ]]; then
    echo "Usage: $0 <version> [--dry-run]"
    echo "Example: $0 0.1.0"
    echo "Example: $0 0.1.0 --dry-run"
    exit 1
fi

# Ensure version doesn't start with 'v'
VERSION="${VERSION#v}"
TAG="v$VERSION"
REPO_URL="https://github.com/shishobooks/plugins"

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "Warning: You have uncommitted changes (ignored in dry-run mode)."
    else
        echo "Error: You have uncommitted changes. Please commit or stash them first."
        exit 1
    fi
fi

# Check we're on master branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "master" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "Warning: Not on master branch (ignored in dry-run mode). Current branch: $CURRENT_BRANCH"
    else
        echo "Error: You must be on the master branch to create a release."
        echo "Current branch: $CURRENT_BRANCH"
        exit 1
    fi
fi

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "Error: Tag $TAG already exists."
    exit 1
fi

if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== DRY RUN: Creating release $TAG ==="
else
    echo "Creating release $TAG..."
fi

# Build plugins
echo "Building plugins..."
yarn build

# Create dist directory if it doesn't exist
DIST_DIR="dist"
if [[ ! -d "$DIST_DIR" ]]; then
    echo "Error: No plugins built. Check the build output."
    exit 1
fi

# Process each plugin
PLUGINS_JSON="[]"
for plugin_dir in "$DIST_DIR"/*/; do
    plugin_name=$(basename "$plugin_dir")
    manifest_file="$plugin_dir/manifest.json"

    if [[ ! -f "$manifest_file" ]]; then
        echo "Warning: No manifest.json found in $plugin_dir, skipping..."
        continue
    fi

    # Read plugin info from manifest
    plugin_id=$(jq -r '.id' "$manifest_file")
    plugin_version=$(jq -r '.version' "$manifest_file")

    echo "Processing plugin: $plugin_id v$plugin_version"

    # Create ZIP file
    zip_name="${plugin_id}-${plugin_version}.zip"
    zip_path="$DIST_DIR/$zip_name"

    (cd "$plugin_dir" && zip -r "../$zip_name" manifest.json main.js)

    # Calculate SHA256
    if [[ "$(uname)" == "Darwin" ]]; then
        sha256=$(shasum -a 256 "$zip_path" | awk '{print $1}')
    else
        sha256=$(sha256sum "$zip_path" | awk '{print $1}')
    fi

    echo "  ZIP: $zip_name"
    echo "  SHA256: $sha256"

    # Build version entry for repository.json
    download_url="$REPO_URL/releases/download/$TAG/$zip_name"
    release_date=$(date +%Y-%m-%d)
done

# Get the previous tag for changelog generation
PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

# Generate changelog entries from commits since last tag
echo "Generating changelog..."

if [[ -n "$PREV_TAG" ]]; then
    COMMIT_RANGE="$PREV_TAG..HEAD"
else
    COMMIT_RANGE="HEAD"
fi

# Initialize category commit lists
COMMITS_FEATURES=""
COMMITS_BUGFIXES=""
COMMITS_DOCS=""
COMMITS_TESTING=""
COMMITS_CICD=""
COMMITS_OTHER=""

while IFS= read -r commit; do
    [[ -z "$commit" ]] && continue

    # Extract category from [Category] format
    if [[ "$commit" =~ ^\[([^\]]+)\] ]]; then
        commit_cat="${BASH_REMATCH[1]}"
        commit_msg="${commit#\[$commit_cat\] }"

        case "$commit_cat" in
            Frontend|Backend|Feature|Feat)
                COMMITS_FEATURES+="- $commit_msg"$'\n'
                ;;
            Fix)
                COMMITS_BUGFIXES+="- $commit_msg"$'\n'
                ;;
            Docs|Doc)
                COMMITS_DOCS+="- $commit_msg"$'\n'
                ;;
            Test|E2E)
                COMMITS_TESTING+="- $commit_msg"$'\n'
                ;;
            CI|CD)
                COMMITS_CICD+="- $commit_msg"$'\n'
                ;;
            *)
                COMMITS_OTHER+="- $commit_msg"$'\n'
                ;;
        esac
    else
        COMMITS_OTHER+="- $commit"$'\n'
    fi
done < <(git log --pretty=format:"%s" $COMMIT_RANGE)

# Build changelog section
CHANGELOG_SECTION="## [$VERSION] - $(date +%Y-%m-%d)"$'\n'

if [[ -n "$COMMITS_FEATURES" ]]; then
    CHANGELOG_SECTION+=$'\n'"### Features"$'\n'
    CHANGELOG_SECTION+="$COMMITS_FEATURES"
fi
if [[ -n "$COMMITS_BUGFIXES" ]]; then
    CHANGELOG_SECTION+=$'\n'"### Bug Fixes"$'\n'
    CHANGELOG_SECTION+="$COMMITS_BUGFIXES"
fi
if [[ -n "$COMMITS_DOCS" ]]; then
    CHANGELOG_SECTION+=$'\n'"### Documentation"$'\n'
    CHANGELOG_SECTION+="$COMMITS_DOCS"
fi
if [[ -n "$COMMITS_TESTING" ]]; then
    CHANGELOG_SECTION+=$'\n'"### Testing"$'\n'
    CHANGELOG_SECTION+="$COMMITS_TESTING"
fi
if [[ -n "$COMMITS_CICD" ]]; then
    CHANGELOG_SECTION+=$'\n'"### CI/CD"$'\n'
    CHANGELOG_SECTION+="$COMMITS_CICD"
fi
if [[ -n "$COMMITS_OTHER" ]]; then
    CHANGELOG_SECTION+=$'\n'"### Other"$'\n'
    CHANGELOG_SECTION+="$COMMITS_OTHER"
fi

# Update repository.json with new versions
echo "Updating repository.json..."

for plugin_dir in "$DIST_DIR"/*/; do
    plugin_name=$(basename "$plugin_dir")
    manifest_file="$plugin_dir/manifest.json"

    if [[ ! -f "$manifest_file" ]]; then
        continue
    fi

    plugin_id=$(jq -r '.id' "$manifest_file")
    plugin_version=$(jq -r '.version' "$manifest_file")
    zip_name="${plugin_id}-${plugin_version}.zip"
    zip_path="$DIST_DIR/$zip_name"

    if [[ "$(uname)" == "Darwin" ]]; then
        sha256=$(shasum -a 256 "$zip_path" | awk '{print $1}')
    else
        sha256=$(sha256sum "$zip_path" | awk '{print $1}')
    fi

    download_url="$REPO_URL/releases/download/$TAG/$zip_name"
    release_date=$(date +%Y-%m-%d)

    # Create new version entry
    new_version=$(jq -n \
        --arg version "$plugin_version" \
        --arg manifestVersion "1" \
        --arg releaseDate "$release_date" \
        --arg changelog "$CHANGELOG_SECTION" \
        --arg downloadUrl "$download_url" \
        --arg sha256 "$sha256" \
        '{
            version: $version,
            manifestVersion: ($manifestVersion | tonumber),
            releaseDate: $releaseDate,
            changelog: $changelog,
            downloadUrl: $downloadUrl,
            sha256: $sha256
        }')

    # Update repository.json - prepend new version to the versions array
    jq --arg id "$plugin_id" --argjson newVersion "$new_version" '
        .plugins = [.plugins[] | if .id == $id then .versions = [$newVersion] + .versions else . end]
    ' repository.json > repository.json.tmp && mv repository.json.tmp repository.json
done

# In dry-run mode, show what would be added to changelog and exit
if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    echo "=== Changelog entry that would be added ==="
    echo "$CHANGELOG_SECTION"
    echo "=== End changelog entry ==="
    echo ""
    echo "=== repository.json updates ==="
    cat repository.json
    echo "=== End repository.json ==="
    echo ""
    echo "Would update:"
    echo "  - CHANGELOG.md"
    echo "  - repository.json"
    echo "  - package.json -> $VERSION"
    echo ""
    echo "Would commit: [Release] $TAG"
    echo "Would create tag: $TAG"
    echo "Would push: master and $TAG to origin"
    echo ""

    # Clean up dist
    rm -rf dist
    git checkout repository.json

    echo "=== DRY RUN COMPLETE ==="
    exit 0
fi

# Update CHANGELOG.md
echo "Updating CHANGELOG.md..."
CHANGELOG_FILE="CHANGELOG.md"

{
    found=false
    while IFS= read -r line; do
        echo "$line"
        if [[ "$line" =~ ^##\ \[Unreleased\] ]] && [[ "$found" == "false" ]]; then
            echo ""
            echo "$CHANGELOG_SECTION"
            found=true
        fi
    done < "$CHANGELOG_FILE"
} > "$CHANGELOG_FILE.tmp" && mv "$CHANGELOG_FILE.tmp" "$CHANGELOG_FILE"

# Update root package.json version
echo "Updating package.json..."
npm version "$VERSION" --no-git-tag-version

# Clean up dist (we don't commit build artifacts)
rm -rf dist

# Commit changes
echo "Committing changes..."
git add CHANGELOG.md package.json repository.json
git commit -m "[Release] $TAG"

# Create tag
echo "Creating tag $TAG..."
git tag -a "$TAG" -m "Release $TAG"

# Push
echo "Pushing to origin..."
git push origin master
git push origin "$TAG"

echo ""
echo "Release $TAG created successfully!"
echo "GitHub Actions will now build and publish the release."
echo ""
echo "View the release at: $REPO_URL/releases/tag/$TAG"
```

**Step 2: Make executable**

```bash
mkdir -p scripts
chmod +x scripts/release.sh
```

**Step 3: Commit**

```bash
git add scripts/release.sh
git commit -m "[Feature] Add release script"
```

---

### Task 9: Create Makefile

**Files:**
- Create: `Makefile`

**Step 1: Create Makefile**

```makefile
.PHONY: build clean test-docker release

build:
	yarn build

clean:
	rm -rf dist

test-docker:
	yarn test:docker

release:
ifndef tag
	$(error tag is required. Usage: make release tag=0.1.0)
endif
ifdef dry-run
	./scripts/release.sh $(tag) --dry-run
else
	./scripts/release.sh $(tag)
endif
```

**Step 2: Commit**

```bash
git add Makefile
git commit -m "[Feature] Add Makefile"
```

---

### Task 10: Create GitHub Actions Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: Create .github/workflows/release.yml**

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*"

permissions:
  contents: write

jobs:
  release:
    name: Build and Release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: ".node-version"
          cache: "yarn"

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Build plugins
        run: yarn build

      - name: Verify SHA256 hashes
        run: |
          for plugin_dir in dist/*/; do
            plugin_name=$(basename "$plugin_dir")
            manifest_file="$plugin_dir/manifest.json"

            if [[ ! -f "$manifest_file" ]]; then
              continue
            fi

            plugin_id=$(jq -r '.id' "$manifest_file")
            plugin_version=$(jq -r '.version' "$manifest_file")
            zip_name="${plugin_id}-${plugin_version}.zip"

            # Create ZIP
            (cd "$plugin_dir" && zip -r "../$zip_name" manifest.json main.js)

            # Calculate SHA256
            actual_sha256=$(sha256sum "dist/$zip_name" | awk '{print $1}')

            # Get expected SHA256 from repository.json
            expected_sha256=$(jq -r --arg id "$plugin_id" --arg version "$plugin_version" \
              '.plugins[] | select(.id == $id) | .versions[] | select(.version == $version) | .sha256' \
              repository.json)

            echo "Plugin: $plugin_id v$plugin_version"
            echo "  Expected SHA256: $expected_sha256"
            echo "  Actual SHA256:   $actual_sha256"

            if [[ "$actual_sha256" != "$expected_sha256" ]]; then
              echo "ERROR: SHA256 mismatch for $plugin_id!"
              exit 1
            fi

            echo "  SHA256 verified!"
          done

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: dist/*.zip
          generate_release_notes: false
          body_path: CHANGELOG.md
```

**Step 2: Create directory structure**

```bash
mkdir -p .github/workflows
```

**Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "[CI] Add GitHub Actions release workflow"
```

---

### Task 11: Install Dependencies and Verify Build

**Step 1: Install dependencies**

```bash
yarn install
```

**Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 3: Verify build**

```bash
yarn build
```

Expected: Output shows "Built open-library-enricher" and creates `dist/open-library-enricher/main.js`

**Step 4: Verify dist structure**

```bash
ls -la dist/open-library-enricher/
```

Expected: `main.js` and `manifest.json` present

**Step 5: Clean up**

```bash
yarn clean
```

**Step 6: Commit yarn.lock**

```bash
git add yarn.lock
git commit -m "[Feature] Add yarn.lock"
```

---

### Task 12: Test Docker Compose Setup

**Step 1: Build plugins**

```bash
yarn build
```

**Step 2: Start Docker Compose**

```bash
docker compose up -d
```

**Step 3: Verify Shisho is running**

```bash
curl -s http://localhost:8080/api/health | jq
```

Expected: Health check response

**Step 4: Verify plugin is loaded**

```bash
curl -s http://localhost:8080/api/plugins | jq
```

Expected: Shows open-library-enricher in installed plugins

**Step 5: Stop Docker Compose**

```bash
docker compose down
```

**Step 6: Clean up**

```bash
yarn clean
```

---

### Task 13: Test Release Script (Dry Run)

**Step 1: Run release script in dry-run mode**

```bash
make release tag=0.1.0 dry-run=1
```

Expected output should show:
- Changelog entry that would be added
- repository.json updates with SHA256 hashes
- List of files that would be updated
- "DRY RUN COMPLETE" message

**Step 2: Verify no changes were made**

```bash
git status
```

Expected: Clean working tree (no uncommitted changes)
