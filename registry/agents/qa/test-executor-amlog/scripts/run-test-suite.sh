#!/usr/bin/env bash
# run-test-suite.sh — Run the full test suite for frontend and backend.
set -euo pipefail

FRONTEND_ROOT="${FRONTEND_ROOT:-../l3-angular-lim-business}"
BACKEND_ROOT="${BACKEND_ROOT:-../l3-net-lim-service}"
SUMMARY_FILE="${SUMMARY_FILE:-.amlog/qa/last-run-summary.json}"
BASELINE_FILE="${BASELINE_FILE:-docs/qa/coverage-baseline.json}"
EXIT_CODE=0

FRONTEND_STATUS="skipped"
FRONTEND_COVERAGE="null"
BACKEND_STATUS="skipped"
BACKEND_COVERAGE="null"
FLAKY_LIST=""

# Extract the overall line-coverage % from an Angular coverage-summary.json,
# or "null" if none is found.
frontend_coverage_pct() {
  local f
  for f in "$FRONTEND_ROOT"/coverage/*/coverage-summary.json; do
    [ -f "$f" ] || continue
    node -e "
      const s = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
      console.log(s.total.lines.pct);
    " "$f" 2>/dev/null && return 0
  done
  echo "null"
}

# Extract the overall line-coverage % from a coverlet lcov.info, or "null".
backend_coverage_pct() {
  local lcov
  lcov=$(find "$BACKEND_ROOT" -name 'lcov.info' -print -quit 2>/dev/null || true)
  if [ -z "$lcov" ]; then
    echo "null"
    return 0
  fi
  awk -F: '/^LH:/{lh+=$2} /^LF:/{lf+=$2} END{ if (lf>0) printf "%.2f\n", (lh/lf)*100; else print "null" }' "$lcov"
}

echo "[test-executor] ===== Frontend Tests (Angular) ====="
if [ -d "$FRONTEND_ROOT" ]; then
  if (cd "$FRONTEND_ROOT" && ng test --watch=false --code-coverage); then
    FRONTEND_STATUS="pass"
  else
    echo "[test-executor] Frontend suite failed — retrying once..."
    if (cd "$FRONTEND_ROOT" && ng test --watch=false --code-coverage); then
      FRONTEND_STATUS="flaky"
      FLAKY_LIST="${FLAKY_LIST}frontend,"
    else
      FRONTEND_STATUS="fail"
      EXIT_CODE=1
    fi
  fi
  FRONTEND_COVERAGE=$(frontend_coverage_pct)
else
  echo "[test-executor] WARNING: Frontend root '$FRONTEND_ROOT' not found, skipping."
fi

echo ""
echo "[test-executor] ===== Backend Tests (.NET) ====="
if [ -d "$BACKEND_ROOT" ]; then
  if (cd "$BACKEND_ROOT" && dotnet test /p:CollectCoverage=true /p:CoverletOutputFormat=lcov); then
    BACKEND_STATUS="pass"
  else
    echo "[test-executor] Backend suite failed — retrying once..."
    if (cd "$BACKEND_ROOT" && dotnet test /p:CollectCoverage=true /p:CoverletOutputFormat=lcov); then
      BACKEND_STATUS="flaky"
      FLAKY_LIST="${FLAKY_LIST}backend,"
    else
      BACKEND_STATUS="fail"
      EXIT_CODE=1
    fi
  fi
  BACKEND_COVERAGE=$(backend_coverage_pct)
else
  echo "[test-executor] WARNING: Backend root '$BACKEND_ROOT' not found, skipping."
fi

mkdir -p "$(dirname "$SUMMARY_FILE")"
cat > "$SUMMARY_FILE" <<EOF
{
  "frontend": { "status": "$FRONTEND_STATUS", "coverage": $FRONTEND_COVERAGE },
  "backend": { "status": "$BACKEND_STATUS", "coverage": $BACKEND_COVERAGE },
  "flaky": "${FLAKY_LIST%,}",
  "exitCode": $EXIT_CODE
}
EOF
echo "[test-executor] Wrote run summary to $SUMMARY_FILE"

# Ratchet the shared, git-committed coverage baseline forward only on a fully
# green run, and only for stacks that actually ran — a partial run (e.g. only
# the backend) must never null out the other stack's last known baseline.
if [ $EXIT_CODE -eq 0 ]; then
  mkdir -p "$(dirname "$BASELINE_FILE")"
  node -e "
    const fs = require('fs');
    const [, baselinePath, feStatus, beStatus, feCovRaw, beCovRaw] = process.argv;
    const prev = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {};
    const feCov = feCovRaw === 'null' ? null : Number(feCovRaw);
    const beCov = beCovRaw === 'null' ? null : Number(beCovRaw);
    const next = {
      frontend: feStatus === 'skipped' ? (prev.frontend ?? null) : feCov,
      backend: beStatus === 'skipped' ? (prev.backend ?? null) : beCov,
    };
    fs.writeFileSync(baselinePath, JSON.stringify(next, null, 2) + '\n');
  " "$BASELINE_FILE" "$FRONTEND_STATUS" "$BACKEND_STATUS" "$FRONTEND_COVERAGE" "$BACKEND_COVERAGE"
  echo "[test-executor] Updated coverage baseline at $BASELINE_FILE"
fi

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "[test-executor] ✅ All tests passed."
else
  echo "[test-executor] ❌ One or more tests failed. See output above."
fi

exit $EXIT_CODE
