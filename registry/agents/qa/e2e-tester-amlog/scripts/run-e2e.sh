#!/usr/bin/env bash
# run-e2e.sh — Run the front-end's end-to-end suite and write .amlog/qa/e2e-report.json
# (schema: .amlog/skills/qa-scope/SKILL.md).
#
# Detects the suite the repo already uses (Playwright, then Cypress); it never imposes a framework.
# If the config declares a `webServer` (Playwright) the runner starts the app itself. Otherwise set
# E2E_SERVER_CMD + E2E_PORT and the app is started/stopped around the run with the shared
# webapp-testing helper.
#
# Env: FRONTEND_ROOT, ISSUE_NUMBER, E2E_GREP (only tests matching this), E2E_PROJECT (Playwright
#      project, e.g. mobile), E2E_SERVER_CMD, E2E_PORT, E2E_DEPTH, REPORT_FILE
# Exit: 0 pass/flaky, 1 fail, 2 error, 3 no-tests / no E2E framework found.
set -uo pipefail

FRONTEND_ROOT="${FRONTEND_ROOT:-../l3-angular-lim-business}"
ISSUE_NUMBER="${ISSUE_NUMBER:-}"
REPORT_FILE="${REPORT_FILE:-.amlog/qa/e2e-report.json}"
DEPTH="${E2E_DEPTH:-full}"
WORKSPACE="$(pwd)"
OUT_DIR="$WORKSPACE/.amlog/qa/e2e"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/results.json "$OUT_DIR"/junit-*.xml "$OUT_DIR"/inner.sh

build_report() {
  node "$SCRIPT_DIR/build-e2e-report.js" --issue "$ISSUE_NUMBER" --depth "$DEPTH" \
    --started "$STARTED" --out "$REPORT_FILE" "$@"
}

if [ ! -d "$FRONTEND_ROOT" ]; then
  echo "[e2e] Front-end root '$FRONTEND_ROOT' not found."
  build_report --exit 2 --notes "front-end root '$FRONTEND_ROOT' not found"
  exit 2
fi

find_config() {
  find "$FRONTEND_ROOT" -maxdepth 2 \( -name node_modules -o -name .git \) -prune -o \
    -type f -name "$1" -print 2>/dev/null | head -n 1
}

PW_CONFIG="$(find_config 'playwright.config.*')"
CY_CONFIG="$(find_config 'cypress.config.*')"

if [ -n "$PW_CONFIG" ]; then
  FRAMEWORK="playwright"; E2E_DIR="$(cd "$(dirname "$PW_CONFIG")" && pwd)"
elif [ -n "$CY_CONFIG" ]; then
  FRAMEWORK="cypress"; E2E_DIR="$(cd "$(dirname "$CY_CONFIG")" && pwd)"
else
  echo "[e2e] No Playwright or Cypress config found under '$FRONTEND_ROOT'."
  echo "[e2e] Write the first E2E suite (see the e2e-testing skill), then re-run."
  build_report --force-status no-tests --notes "no Playwright/Cypress config under $FRONTEND_ROOT — bootstrap an E2E suite first"
  exit 3
fi
echo "[e2e] Framework: $FRAMEWORK (in $E2E_DIR)"

# Inner script = the actual test command; it may run bare or inside the dev-server wrapper.
if [ "$FRAMEWORK" = "playwright" ]; then
  {
    echo '#!/usr/bin/env bash'
    echo "cd \"$E2E_DIR\""
    printf 'PLAYWRIGHT_JSON_OUTPUT_NAME=%q npx playwright test --reporter=json,list --retries=1 --trace=retain-on-failure' "$OUT_DIR/results.json"
    [ -n "${E2E_GREP:-}" ] && printf ' --grep %q' "$E2E_GREP"
    [ -n "${E2E_PROJECT:-}" ] && printf ' --project %q' "$E2E_PROJECT"
    echo
  } > "$OUT_DIR/inner.sh"
  REPORT_FORMAT="playwright"; REPORT_INPUT="$OUT_DIR/results.json"
else
  {
    echo '#!/usr/bin/env bash'
    echo "cd \"$E2E_DIR\""
    printf 'npx cypress run --reporter junit --reporter-options %q' "mochaFile=$OUT_DIR/junit-[hash].xml"
    [ -n "${E2E_GREP:-}" ] && printf ' --spec %q' "$E2E_GREP"
    echo
  } > "$OUT_DIR/inner.sh"
  REPORT_FORMAT="junit"
fi
chmod +x "$OUT_DIR/inner.sh"

if [ -n "${E2E_SERVER_CMD:-}" ]; then
  HELPER="$WORKSPACE/.amlog/skills/webapp-testing/scripts/with_server.py"
  if [ ! -f "$HELPER" ] || [ -z "${E2E_PORT:-}" ]; then
    echo "[e2e] E2E_SERVER_CMD needs E2E_PORT and the webapp-testing skill ($HELPER)."
    build_report --exit 2 --notes "E2E_SERVER_CMD set but E2E_PORT or the webapp-testing helper is missing"
    exit 2
  fi
  echo "[e2e] Starting app: $E2E_SERVER_CMD (port $E2E_PORT)"
  python3 "$HELPER" --server "$E2E_SERVER_CMD" --port "$E2E_PORT" -- bash "$OUT_DIR/inner.sh"
else
  bash "$OUT_DIR/inner.sh"
fi
RUN_EXIT=$?

if [ "$FRAMEWORK" = "cypress" ]; then
  # one JUnit file per spec; merge into a single XML body for the parser
  REPORT_INPUT="$OUT_DIR/junit-all.xml"
  cat "$OUT_DIR"/junit-*.xml 2>/dev/null | grep -v '^<?xml' > "$REPORT_INPUT" || : > "$REPORT_INPUT"
fi

SUMMARY="$(build_report --format "$REPORT_FORMAT" --input "$REPORT_INPUT" --exit "$RUN_EXIT")"
echo "[e2e] $SUMMARY"

STATUS="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).status)" "$REPORT_FILE")"
case "$STATUS" in
  pass|flaky) exit 0 ;;
  fail)       exit 1 ;;
  no-tests)   exit 3 ;;
  *)          exit 2 ;;
esac
