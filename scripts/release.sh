#!/usr/bin/env bash
set -euo pipefail

# Per-plugin release script for Shisho Plugins
# Usage: ./scripts/release.sh <plugin-id> <version> [--dry-run]
# Example: ./scripts/release.sh open-library-enricher 0.1.0
# Example: ./scripts/release.sh open-library-enricher 0.1.0 --dry-run

DRY_RUN=false
PLUGIN_ID=""
VERSION=""

# Parse arguments
for arg in "$@"; do
    case "$arg" in
        --dry-run)
            DRY_RUN=true
            ;;
        *)
            if [[ -z "$PLUGIN_ID" ]]; then
                PLUGIN_ID="$arg"
            elif [[ -z "$VERSION" ]]; then
                VERSION="$arg"
            fi
            ;;
    esac
done

if [[ -z "$PLUGIN_ID" || -z "$VERSION" ]]; then
    echo "Usage: $0 <plugin-id> <version> [--dry-run]"
    echo "Example: $0 open-library-enricher 0.1.0"
    echo "Example: $0 open-library-enricher 0.1.0 --dry-run"
    exit 1
fi

# Ensure version doesn't start with 'v'
VERSION="${VERSION#v}"
TAG="${PLUGIN_ID}@${VERSION}"
REPO_URL="https://github.com/shishobooks/plugins"

PLUGIN_DIR="plugins/$PLUGIN_ID"
PLUGIN_MANIFEST="$PLUGIN_DIR/manifest.json"
PLUGIN_PACKAGE="$PLUGIN_DIR/package.json"
PLUGIN_CHANGELOG="$PLUGIN_DIR/CHANGELOG.md"

# --- Plugin validation ---
available_plugins() {
    jq -r '.plugins[].id' repository.json | sed 's/^/  - /'
}

if [[ ! -d "$PLUGIN_DIR" ]]; then
    echo "Error: Plugin directory '$PLUGIN_DIR' does not exist."
    echo "Available plugins:"
    available_plugins
    exit 1
fi

if [[ ! -f "$PLUGIN_MANIFEST" ]]; then
    echo "Error: Manifest not found at '$PLUGIN_MANIFEST'."
    echo "Available plugins:"
    available_plugins
    exit 1
fi

MANIFEST_ID=$(jq -r '.id' "$PLUGIN_MANIFEST")
if [[ "$MANIFEST_ID" != "$PLUGIN_ID" ]]; then
    echo "Error: Manifest id '$MANIFEST_ID' does not match plugin-id '$PLUGIN_ID'."
    exit 1
fi

if ! jq -e --arg id "$PLUGIN_ID" '.plugins[] | select(.id == $id)' repository.json >/dev/null 2>&1; then
    echo "Error: Plugin '$PLUGIN_ID' is not registered in repository.json."
    echo "Available plugins:"
    available_plugins
    exit 1
fi

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

# --- Bump versions in source files ---
echo "Bumping version to $VERSION..."
jq --arg v "$VERSION" '.version = $v' "$PLUGIN_MANIFEST" > "$PLUGIN_MANIFEST.tmp" && mv "$PLUGIN_MANIFEST.tmp" "$PLUGIN_MANIFEST"
jq --arg v "$VERSION" '.version = $v' "$PLUGIN_PACKAGE" > "$PLUGIN_PACKAGE.tmp" && mv "$PLUGIN_PACKAGE.tmp" "$PLUGIN_PACKAGE"

# --- Build plugins ---
echo "Building plugins..."
yarn build

# Check dist output exists for target plugin
DIST_DIR="dist"
DIST_PLUGIN_DIR="$DIST_DIR/$PLUGIN_ID"

if [[ ! -d "$DIST_PLUGIN_DIR" ]]; then
    echo "Error: Build output for '$PLUGIN_ID' not found at '$DIST_PLUGIN_DIR'."
    exit 1
fi

MANIFEST_FILE="$DIST_PLUGIN_DIR/manifest.json"
if [[ ! -f "$MANIFEST_FILE" ]]; then
    echo "Error: No manifest.json found in $DIST_PLUGIN_DIR."
    exit 1
fi

# Read plugin info from built manifest
BUILT_VERSION=$(jq -r '.version' "$MANIFEST_FILE")
echo "Processing plugin: $PLUGIN_ID v$BUILT_VERSION"

# Create ZIP file
ZIP_NAME="${PLUGIN_ID}-${VERSION}.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

(cd "$DIST_PLUGIN_DIR" && zip -r "../$ZIP_NAME" manifest.json main.js)

# Calculate SHA256
if [[ "$(uname)" == "Darwin" ]]; then
    SHA256=$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')
else
    SHA256=$(sha256sum "$ZIP_PATH" | awk '{print $1}')
fi

echo "  ZIP: $ZIP_NAME"
echo "  SHA256: $SHA256"

# --- Generate changelog from commits since last release of this plugin ---
PREV_TAG=$(git tag -l "${PLUGIN_ID}@*" --sort=-v:refname | head -1 || true)

echo "Generating changelog..."

if [[ -n "$PREV_TAG" ]]; then
    COMMIT_RANGE="$PREV_TAG..HEAD"
else
    # First release: include all commits
    COMMIT_RANGE=""
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
done < <(git log --pretty=format:"%s" ${COMMIT_RANGE:+"$COMMIT_RANGE"} -- "plugins/$PLUGIN_ID")

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

# --- Update repository.json ---
echo "Updating repository.json..."

DOWNLOAD_URL="$REPO_URL/releases/download/$TAG/$ZIP_NAME"
RELEASE_DATE=$(date +%Y-%m-%d)

MANIFEST_VER=$(jq -r '.manifestVersion' "$MANIFEST_FILE")
MIN_SHISHO_VER=$(jq -r '.minShishoVersion // ""' "$MANIFEST_FILE")

NEW_VERSION=$(jq -n \
    --arg version "$VERSION" \
    --arg manifestVersion "$MANIFEST_VER" \
    --arg minShishoVersion "$MIN_SHISHO_VER" \
    --arg releaseDate "$RELEASE_DATE" \
    --arg changelog "$CHANGELOG_SECTION" \
    --arg downloadUrl "$DOWNLOAD_URL" \
    --arg sha256 "$SHA256" \
    '{
        version: $version,
        manifestVersion: ($manifestVersion | tonumber),
        releaseDate: $releaseDate,
        changelog: $changelog,
        downloadUrl: $downloadUrl,
        sha256: $sha256
    } + (if $minShishoVersion != "" then {minShishoVersion: $minShishoVersion} else {} end)')

jq --arg id "$PLUGIN_ID" --argjson newVersion "$NEW_VERSION" '
    .plugins = [.plugins[] | if .id == $id then .versions = [$newVersion] + .versions else . end]
' repository.json > repository.json.tmp && mv repository.json.tmp repository.json

# --- Dry-run: show results and clean up ---
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
    echo "  - $PLUGIN_CHANGELOG"
    echo "  - $PLUGIN_MANIFEST"
    echo "  - $PLUGIN_PACKAGE"
    echo "  - repository.json"
    echo ""
    echo "Would commit: [Release] $TAG"
    echo "Would create tag: $TAG"
    echo "Would push: master and $TAG to origin"
    echo ""

    # Clean up
    rm -rf dist
    git checkout "$PLUGIN_MANIFEST" "$PLUGIN_PACKAGE" repository.json

    echo "=== DRY RUN COMPLETE ==="
    exit 0
fi

# --- Update per-plugin CHANGELOG.md ---
echo "Updating $PLUGIN_CHANGELOG..."

{
    found=false
    while IFS= read -r line; do
        echo "$line"
        if [[ "$line" =~ ^##\ \[Unreleased\] ]] && [[ "$found" == "false" ]]; then
            echo ""
            echo "$CHANGELOG_SECTION"
            found=true
        fi
    done < "$PLUGIN_CHANGELOG"
} > "$PLUGIN_CHANGELOG.tmp" && mv "$PLUGIN_CHANGELOG.tmp" "$PLUGIN_CHANGELOG"

# Clean up dist (we don't commit build artifacts)
rm -rf dist

# Commit changes (only relevant files)
echo "Committing changes..."
git add "$PLUGIN_MANIFEST" "$PLUGIN_PACKAGE" "$PLUGIN_CHANGELOG" repository.json
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
