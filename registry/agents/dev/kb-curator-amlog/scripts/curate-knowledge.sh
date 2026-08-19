#!/usr/bin/env bash
# curate-knowledge.sh — Collect _pending knowledge entries from all repos.
# Run daily (e.g. via cron or CI schedule) from the amlog workspace root.
set -euo pipefail

DATE=$(date +%Y-%m-%d)
FRONTEND_REPO="${FRONTEND_REPO:-../l3-angular-lim-business}"
BACKEND_REPO="${BACKEND_REPO:-../l3-net-lim-service}"
KB_OUTPUT=".knowledge-graph/knowledge-base.md"
PENDING_DIR=".knowledge-graph/_pending"
BRANCH="kb/curate-$DATE"

log() { echo "[kb-curator] $*"; }

log "Starting knowledge sweep for $DATE..."

# Collect pending files from both repos
ALL_PENDING=()
for REPO in "$FRONTEND_REPO" "$BACKEND_REPO"; do
  if [ -d "$REPO/.knowledge-graph/_pending" ]; then
    while IFS= read -r f; do
      ALL_PENDING+=("$f")
    done < <(find "$REPO/.knowledge-graph/_pending" -name "*.md" -type f)
  fi
done

if [ ${#ALL_PENDING[@]} -eq 0 ]; then
  log "No pending entries found. Nothing to do."
  exit 0
fi

log "Found ${#ALL_PENDING[@]} pending file(s)."

# Create output branch
git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"

# Merge entries into knowledge base
for file in "${ALL_PENDING[@]}"; do
  log "Merging: $file"
  echo "" >> "$KB_OUTPUT"
  cat "$file" >> "$KB_OUTPUT"
done

git add "$KB_OUTPUT"
git commit -m "📚 kb: daily knowledge sweep $DATE"
git push origin "$BRANCH"

# Open PR via GitHub CLI
if command -v gh >/dev/null 2>&1; then
  gh pr create \
    --title "[KB] Daily knowledge sweep $DATE" \
    --body "Automated sweep of _pending knowledge entries from all repos on $DATE." \
    --base main
  log "PR created."
else
  log "WARNING: gh CLI not found. Push complete but PR must be created manually."
fi

log "Done."
