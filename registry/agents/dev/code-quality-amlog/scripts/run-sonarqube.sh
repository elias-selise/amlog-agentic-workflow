#!/usr/bin/env bash
# run-sonarqube.sh — Trigger a SonarQube scan and report the quality gate result.
# Requires SONAR_HOST_URL and SONAR_TOKEN to be set in the environment or .env file.
set -euo pipefail

SONAR_HOST_URL="${SONAR_HOST_URL:-http://localhost:9000}"
SONAR_TOKEN="${SONAR_TOKEN:-}"
PROJECT_KEY="${SONAR_PROJECT_KEY:-amlog-project}"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ -z "$SONAR_TOKEN" ]; then
  echo "[code-quality] ERROR: SONAR_TOKEN is not set."
  exit 1
fi

echo "[code-quality] Running SonarQube scan for branch: $BRANCH"

# Run sonar-scanner (must be installed: https://docs.sonarqube.org/latest/analysis/scan/sonarscanner/)
sonar-scanner \
  -Dsonar.projectKey="$PROJECT_KEY" \
  -Dsonar.host.url="$SONAR_HOST_URL" \
  -Dsonar.token="$SONAR_TOKEN" \
  -Dsonar.branch.name="$BRANCH"

echo "[code-quality] Scan submitted. Waiting for quality gate result..."
sleep 5

# Fetch gate status
STATUS=$(curl -s -u "$SONAR_TOKEN:" \
  "$SONAR_HOST_URL/api/qualitygates/project_status?projectKey=$PROJECT_KEY&branch=$BRANCH" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['projectStatus']['status'])")

echo "[code-quality] Quality gate status: $STATUS"

if [ "$STATUS" = "ERROR" ]; then
  echo "[code-quality] GATE FAILED — check SonarQube dashboard."
  exit 1
else
  echo "[code-quality] GATE PASSED."
fi
