#!/usr/bin/env bash
set -euo pipefail

# Per-plugin release script for Shisho Plugins
# Usage: ./scripts/release.sh <plugin-id> <version> [<plugin-id> <version> ...] [--dry-run]
# Examples:
#   ./scripts/release.sh open-library-enricher 0.1.0
#   ./scripts/release.sh open-library-enricher 0.2.0 goodreads-enricher 0.1.0
#   ./scripts/release.sh open-library-enricher 0.1.0 --dry-run

DRY_RUN=false
POSITIONAL_ARGS=()

# Parse arguments — separate --dry-run from positional args
for arg in "$@"; do
    case "$arg" in
        --dry-run)
            DRY_RUN=true
            ;;
        *)
            POSITIONAL_ARGS+=("$arg")
            ;;
    esac
done

# Positional args must come in pairs: <plugin-id> <version>
if [[ ${#POSITIONAL_ARGS[@]} -eq 0 ]] || [[ $(( ${#POSITIONAL_ARGS[@]} % 2 )) -ne 0 ]]; then
    echo "Usage: $0 <plugin-id> <version> [<plugin-id> <version> ...] [--dry-run]"
    echo "Examples:"
    echo "  $0 open-library-enricher 0.1.0"
    echo "  $0 open-library-enricher 0.2.0 goodreads-enricher 0.1.0"
    echo "  $0 open-library-enricher 0.1.0 --dry-run"
    exit 1
fi

# Build arrays of plugin IDs and versions
PLUGIN_IDS=()
VERSIONS=()
TAGS=()
for (( i=0; i<${#POSITIONAL_ARGS[@]}; i+=2 )); do
    pid="${POSITIONAL_ARGS[$i]}"
    ver="${POSITIONAL_ARGS[$i+1]}"
    ver="${ver#v}"  # Strip leading 'v'
    PLUGIN_IDS+=("$pid")
    VERSIONS+=("$ver")
    TAGS+=("${pid}@${ver}")
done

REPO_URL="https://github.com/shishobooks/plugins"

# --- Helper functions ---
available_plugins() {
    jq -r '.plugins[].id' repository.json | sed 's/^/  - /'
}

# --- Validate ALL plugins before making any changes ---
echo "Validating ${#PLUGIN_IDS[@]} plugin(s)..."

# Check for duplicate plugin IDs
for (( i=0; i<${#PLUGIN_IDS[@]}; i++ )); do
    for (( j=i+1; j<${#PLUGIN_IDS[@]}; j++ )); do
        if [[ "${PLUGIN_IDS[$i]}" == "${PLUGIN_IDS[$j]}" ]]; then
            echo "Error: Plugin '${PLUGIN_IDS[$i]}' specified more than once."
            exit 1
        fi
    done
done

for (( i=0; i<${#PLUGIN_IDS[@]}; i++ )); do
    PLUGIN_ID="${PLUGIN_IDS[$i]}"
    TAG="${TAGS[$i]}"
    PLUGIN_DIR="plugins/$PLUGIN_ID"
    PLUGIN_MANIFEST="$PLUGIN_DIR/manifest.json"

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

    if [[ ! -f "$PLUGIN_DIR/package.json" ]]; then
        echo "Error: package.json not found at '$PLUGIN_DIR/package.json'."
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

    if git rev-parse "$TAG" >/dev/null 2>&1; then
        echo "Error: Tag $TAG already exists."
        exit 1
    fi

    echo "  ✓ $TAG"
done

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

# --- Format release description ---
RELEASE_DESC="${TAGS[0]}"
for (( i=1; i<${#TAGS[@]}; i++ )); do
    RELEASE_DESC+=", ${TAGS[$i]}"
done

if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== DRY RUN: Creating release(s) $RELEASE_DESC ==="
else
    echo "Creating release(s) $RELEASE_DESC..."
fi

# --- Rollback on error: restore modified files if script fails mid-release ---
RELEASE_COMMITTED=false
cleanup_on_error() {
    if [[ "$RELEASE_COMMITTED" == "true" ]]; then
        return
    fi
    echo ""
    echo "Error occurred — restoring modified files..."
    rm -rf dist
    FILES_TO_RESTORE=()
    for (( i=0; i<${#PLUGIN_IDS[@]}; i++ )); do
        FILES_TO_RESTORE+=("plugins/${PLUGIN_IDS[$i]}/manifest.json" "plugins/${PLUGIN_IDS[$i]}/package.json" "plugins/${PLUGIN_IDS[$i]}/CHANGELOG.md")
    done
    FILES_TO_RESTORE+=("repository.json")
    git checkout "${FILES_TO_RESTORE[@]}" 2>/dev/null || true
}
trap cleanup_on_error ERR

# --- Bump versions in source files for all plugins ---
for (( i=0; i<${#PLUGIN_IDS[@]}; i++ )); do
    PLUGIN_ID="${PLUGIN_IDS[$i]}"
    VERSION="${VERSIONS[$i]}"
    PLUGIN_MANIFEST="plugins/$PLUGIN_ID/manifest.json"
    PLUGIN_PACKAGE="plugins/$PLUGIN_ID/package.json"

    echo "Bumping $PLUGIN_ID to $VERSION..."
    jq --arg v "$VERSION" '.version = $v' "$PLUGIN_MANIFEST" > "$PLUGIN_MANIFEST.tmp" && mv "$PLUGIN_MANIFEST.tmp" "$PLUGIN_MANIFEST"
    jq --arg v "$VERSION" '.version = $v' "$PLUGIN_PACKAGE" > "$PLUGIN_PACKAGE.tmp" && mv "$PLUGIN_PACKAGE.tmp" "$PLUGIN_PACKAGE"
done

# --- Build all plugins (single build) ---
echo "Building plugins..."
pnpm build

# --- Process each plugin: ZIP, SHA256, changelog, repository.json ---
DIST_DIR="dist"
declare -a CHANGELOG_SECTIONS=()

for (( i=0; i<${#PLUGIN_IDS[@]}; i++ )); do
    PLUGIN_ID="${PLUGIN_IDS[$i]}"
    VERSION="${VERSIONS[$i]}"
    TAG="${TAGS[$i]}"
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

    echo "Generating changelog for $PLUGIN_ID..."

    if [[ -n "$PREV_TAG" ]]; then
        COMMIT_RANGE="$PREV_TAG..HEAD"
    else
        COMMIT_RANGE=""
    fi

    COMMITS_FEATURES=""
    COMMITS_BUGFIXES=""
    COMMITS_DOCS=""
    COMMITS_TESTING=""
    COMMITS_CICD=""
    COMMITS_OTHER=""

    while IFS= read -r commit; do
        [[ -z "$commit" ]] && continue

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

    CHANGELOG_SECTIONS+=("$CHANGELOG_SECTION")

    # --- Update repository.json ---
    echo "Updating repository.json for $PLUGIN_ID..."

    DOWNLOAD_URL="$REPO_URL/releases/download/$TAG/$ZIP_NAME"
    RELEASE_DATE=$(date +%Y-%m-%d)

    MANIFEST_VER=$(jq -r '.manifestVersion' "$MANIFEST_FILE")
    MIN_SHISHO_VER=$(jq -r '.minShishoVersion // ""' "$MANIFEST_FILE")
    CAPABILITIES=$(jq '.capabilities // null' "$MANIFEST_FILE")

    NEW_VERSION=$(jq -n \
        --arg version "$VERSION" \
        --arg manifestVersion "$MANIFEST_VER" \
        --arg minShishoVersion "$MIN_SHISHO_VER" \
        --arg releaseDate "$RELEASE_DATE" \
        --arg changelog "$CHANGELOG_SECTION" \
        --arg downloadUrl "$DOWNLOAD_URL" \
        --arg sha256 "$SHA256" \
        --argjson capabilities "$CAPABILITIES" \
        '{
            version: $version,
            manifestVersion: ($manifestVersion | tonumber),
            releaseDate: $releaseDate,
            changelog: $changelog,
            downloadUrl: $downloadUrl,
            sha256: $sha256
        } + (if $minShishoVersion != "" then {minShishoVersion: $minShishoVersion} else {} end)
          + (if $capabilities != null then {capabilities: $capabilities} else {} end)')

    jq --arg id "$PLUGIN_ID" --argjson newVersion "$NEW_VERSION" '
        .plugins = [.plugins[] | if .id == $id then .versions = [$newVersion] + .versions else . end]
    ' repository.json > repository.json.tmp && mv repository.json.tmp repository.json
done

# --- Dry-run: show results and clean up ---
if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    for (( i=0; i<${#PLUGIN_IDS[@]}; i++ )); do
        echo "=== Changelog entry for ${PLUGIN_IDS[$i]} ==="
        echo "${CHANGELOG_SECTIONS[$i]}"
        echo "=== End changelog entry ==="
        echo ""
    done
    echo "=== repository.json updates ==="
    cat repository.json
    echo "=== End repository.json ==="
    echo ""
    echo "Would update:"
    for (( i=0; i<${#PLUGIN_IDS[@]}; i++ )); do
        echo "  - plugins/${PLUGIN_IDS[$i]}/CHANGELOG.md"
        echo "  - plugins/${PLUGIN_IDS[$i]}/manifest.json"
        echo "  - plugins/${PLUGIN_IDS[$i]}/package.json"
    done
    echo "  - repository.json"
    echo ""
    echo "Would commit: [Release] $RELEASE_DESC"
    for (( i=0; i<${#TAGS[@]}; i++ )); do
        echo "Would create tag: ${TAGS[$i]}"
    done
    echo "Would push: master and all tags to origin"
    echo ""

    # Clean up — restore all modified files
    rm -rf dist
    FILES_TO_RESTORE=()
    for (( i=0; i<${#PLUGIN_IDS[@]}; i++ )); do
        FILES_TO_RESTORE+=("plugins/${PLUGIN_IDS[$i]}/manifest.json" "plugins/${PLUGIN_IDS[$i]}/package.json" "plugins/${PLUGIN_IDS[$i]}/CHANGELOG.md")
    done
    FILES_TO_RESTORE+=("repository.json")
    git checkout "${FILES_TO_RESTORE[@]}"

    echo "=== DRY RUN COMPLETE ==="
    exit 0
fi

# --- Update per-plugin CHANGELOG.md files ---
for (( i=0; i<${#PLUGIN_IDS[@]}; i++ )); do
    PLUGIN_ID="${PLUGIN_IDS[$i]}"
    PLUGIN_CHANGELOG="plugins/$PLUGIN_ID/CHANGELOG.md"
    CHANGELOG_SECTION="${CHANGELOG_SECTIONS[$i]}"

    echo "Updating $PLUGIN_CHANGELOG..."

    {
        found=false
        while IFS= read -r line || [[ -n "$line" ]]; do
            echo "$line"
            if [[ "$line" =~ ^##\ \[Unreleased\] ]] && [[ "$found" == "false" ]]; then
                echo ""
                echo "$CHANGELOG_SECTION"
                found=true
            fi
        done < "$PLUGIN_CHANGELOG"

        # If no ## [Unreleased] header exists, append one with the new section
        if [[ "$found" == "false" ]]; then
            echo "  Warning: No '## [Unreleased]' header found in $PLUGIN_CHANGELOG. Appending one." >&2
            echo ""
            echo "## [Unreleased]"
            echo ""
            echo "$CHANGELOG_SECTION"
        fi
    } > "$PLUGIN_CHANGELOG.tmp" && mv "$PLUGIN_CHANGELOG.tmp" "$PLUGIN_CHANGELOG"
done

# Clean up dist (we don't commit build artifacts)
rm -rf dist

# Commit changes (all relevant files)
echo "Committing changes..."
GIT_ADD_FILES=()
for (( i=0; i<${#PLUGIN_IDS[@]}; i++ )); do
    GIT_ADD_FILES+=("plugins/${PLUGIN_IDS[$i]}/manifest.json" "plugins/${PLUGIN_IDS[$i]}/package.json" "plugins/${PLUGIN_IDS[$i]}/CHANGELOG.md")
done
GIT_ADD_FILES+=("repository.json")
git add "${GIT_ADD_FILES[@]}"
git commit -m "[Release] $RELEASE_DESC"
RELEASE_COMMITTED=true

# Create tags
for (( i=0; i<${#TAGS[@]}; i++ )); do
    echo "Creating tag ${TAGS[$i]}..."
    git tag -a "${TAGS[$i]}" -m "Release ${TAGS[$i]}"
done

# Push
echo "Pushing to origin..."
git push origin master "${TAGS[@]}"

echo ""
echo "Release(s) created successfully!"
echo "GitHub Actions will now build and publish each release."
echo ""
for (( i=0; i<${#TAGS[@]}; i++ )); do
    echo "  $REPO_URL/releases/tag/${TAGS[$i]}"
done
