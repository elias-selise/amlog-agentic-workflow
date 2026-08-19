#!/usr/bin/env bash
# setup-knowledge-base.sh — Install and initialize CodeGraph for the workspace.
# This script is the shell equivalent of src/lib/knowledge-base.js.
set -euo pipefail

CONFIG_FILE="amlog-workflow.config.json"
REPO_ROOT="$(pwd)"

log() { echo "[kb-setup] $*"; }

# Step 1: Ensure CodeGraph is installed
if command -v codegraph >/dev/null 2>&1; then
  log "CodeGraph CLI already installed."
  codegraph upgrade --check || true
else
  log "CodeGraph CLI not found. Installing..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh
  elif command -v npm >/dev/null 2>&1; then
    npm i -g @colbymchenry/codegraph
  else
    log "ERROR: neither curl nor npm available. Aborting."
    exit 1
  fi
fi

# Step 2: Wire CodeGraph into detected agent CLIs
log "Wiring CodeGraph into detected agent CLIs..."
codegraph install --target=auto --location=global --yes || true

# Step 3: Resolve zone paths
declare -a ZONE_PATHS=()
if [ -f "$CONFIG_FILE" ]; then
  log "Found $CONFIG_FILE — reading zones..."
  if command -v jq >/dev/null 2>&1; then
    while IFS= read -r p; do ZONE_PATHS+=("$p"); done \
      < <(jq -r '.zones // {} | to_entries[] | .value' "$CONFIG_FILE")
  else
    while IFS= read -r p; do ZONE_PATHS+=("$p"); done \
      < <(python3 -c "
import json
with open('$CONFIG_FILE') as f: cfg = json.load(f)
for v in cfg.get('zones', {}).values(): print(v)
")
  fi
else
  log "No $CONFIG_FILE found — indexing repo root as single zone."
  log "Tip: add a $CONFIG_FILE if this is a multi-zone repo."
  ZONE_PATHS=(".")
fi

# Step 4: Init each zone
for zone in "${ZONE_PATHS[@]}"; do
  target="$REPO_ROOT/$zone"
  if [ ! -d "$target" ]; then
    log "WARNING: zone '$zone' does not exist, skipping."
    continue
  fi
  log "Indexing zone: $zone"
  (cd "$target" && codegraph init) || log "WARNING: codegraph init failed for '$zone'."
done

log "Done."

# Step 5: Print status for each zone
echo ""
log "Knowledge base index status:"
for zone in "${ZONE_PATHS[@]}"; do
  target="$REPO_ROOT/$zone"
  [ -d "$target" ] || continue
  echo "--- $zone ---"
  (cd "$target" && codegraph status) || true
done
