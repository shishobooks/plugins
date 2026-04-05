#!/usr/bin/env bash
set -euo pipefail

# Per-plugin release script for Shisho Plugins
# Validates locally, then dispatches the GitHub Actions release workflow.
#
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
    if [[ ! "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Error: Version '$ver' is not valid semver (expected X.Y.Z)."
        exit 1
    fi
    PLUGIN_IDS+=("$pid")
    VERSIONS+=("$ver")
    TAGS+=("${pid}@${ver}")
done

# --- Helper functions ---
available_plugins() {
    jq -r '.plugins[].id' repository.json | sed 's/^/  - /'
}

# --- Validate ALL plugins before dispatching ---
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

    echo "  OK $TAG"
done

# --- Build JSON payload ---
JSON_ARRAY="[]"
for (( i=0; i<${#PLUGIN_IDS[@]}; i++ )); do
    JSON_ARRAY=$(echo "$JSON_ARRAY" | jq -c \
        --arg id "${PLUGIN_IDS[$i]}" \
        --arg version "${VERSIONS[$i]}" \
        '. + [{id: $id, version: $version}]')
done

# --- Format release description ---
RELEASE_DESC="${TAGS[0]}"
for (( i=1; i<${#TAGS[@]}; i++ )); do
    RELEASE_DESC+=", ${TAGS[$i]}"
done

# --- Dry run: show what would be dispatched ---
if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    echo "=== DRY RUN ==="
    echo "Would dispatch release workflow with:"
    echo "  Plugins: $JSON_ARRAY"
    echo ""
    echo "Releases:"
    for (( i=0; i<${#TAGS[@]}; i++ )); do
        echo "  - ${TAGS[$i]}"
    done
    echo ""
    echo "=== DRY RUN COMPLETE ==="
    exit 0
fi

# --- Dispatch the release workflow ---
echo ""
echo "Dispatching release workflow for $RELEASE_DESC..."

# Record the latest run ID before dispatch so we can find the new one
BEFORE_RUN_ID=$(gh run list --workflow=release.yml --limit=1 --json databaseId --jq '.[0].databaseId // 0' 2>/dev/null || echo "0")

gh workflow run release.yml -f plugins="$JSON_ARRAY"

echo "Waiting for workflow to start..."

# Poll until the new run appears
RUN_ID=""
for (( attempt=0; attempt<30; attempt++ )); do
    sleep 2
    LATEST_RUN_ID=$(gh run list --workflow=release.yml --limit=1 --json databaseId --jq '.[0].databaseId // 0' 2>/dev/null || echo "0")
    if [[ "$LATEST_RUN_ID" != "$BEFORE_RUN_ID" && "$LATEST_RUN_ID" != "0" ]]; then
        RUN_ID="$LATEST_RUN_ID"
        break
    fi
done

if [[ -z "$RUN_ID" ]]; then
    echo "Could not detect the workflow run. Check manually:"
    echo "  https://github.com/shishobooks/plugins/actions/workflows/release.yml"
    exit 1
fi

REPO_URL=$(gh repo view --json url --jq '.url')
echo "Workflow started: $REPO_URL/actions/runs/$RUN_ID"
echo ""

# Stream logs and wait for completion
gh run watch "$RUN_ID"
