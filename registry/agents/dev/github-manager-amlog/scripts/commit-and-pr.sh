#!/usr/bin/env bash
# commit-and-pr.sh — Commit staged changes and open a draft PR.
# Usage: commit-and-pr.sh "<gitmoji-commit-message>" "<pr-title>" "<issue-number>"
set -euo pipefail

COMMIT_MSG="${1:-}"
PR_TITLE="${2:-}"
ISSUE_NUMBER="${3:-}"

if [ -z "$COMMIT_MSG" ]; then
  echo "Usage: $0 '<commit-message>' '<pr-title>' '<issue-number>'"
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "[github-manager] Committing on branch: $BRANCH"

git add -A
git commit -m "$COMMIT_MSG"
git push origin "$BRANCH"

# Open draft PR via GitHub CLI (gh must be installed)
if command -v gh >/dev/null 2>&1; then
  PR_BODY="Closes #${ISSUE_NUMBER}

## Summary
$(git log --oneline origin/main..HEAD)

## Checklist
- [ ] AC verified
- [ ] Tests pass
- [ ] Security review passed
- [ ] Quality gate passed
"
  gh pr create \
    --title "${PR_TITLE:-$COMMIT_MSG}" \
    --body "$PR_BODY" \
    --draft \
    --base main
  echo "[github-manager] Draft PR created."
else
  echo "[github-manager] WARNING: 'gh' CLI not found. Push complete but PR not created automatically."
  echo "[github-manager] Install GitHub CLI (https://cli.github.com/) to enable auto-PR."
fi
