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
