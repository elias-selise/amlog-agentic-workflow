#!/usr/bin/env bash
# run-contract-tests.sh — Run the back-end API contract checks and write
# .amlog/qa/api-contract-report.json (schema: .amlog/skills/qa-scope/SKILL.md).
#
# Three layers, each optional except the first:
#   1. dotnet contract/API tests   (xUnit tests tagged Category=Contract or Category=Api)
#   2. OpenAPI breaking-change diff against the base branch   (needs `oasdiff`)
#   3. schema-driven fuzzing of the running API               (CONTRACT_FUZZ=1, needs `schemathesis`/`st`)
#
# Env: BACKEND_ROOT, BASE_BRANCH, ISSUE_NUMBER, OPENAPI_SPEC, BASE_URL, CONTRACT_FUZZ,
#      CONTRACT_TEST_FILTER, CONTRACT_DEPTH, REPORT_FILE
# Exit: 0 pass/flaky/skipped-like, 1 fail, 2 error, 3 no-tests.
set -uo pipefail

BACKEND_ROOT="${BACKEND_ROOT:-../l3-net-lim-service}"
BASE_BRANCH="${BASE_BRANCH:-main}"
ISSUE_NUMBER="${ISSUE_NUMBER:-}"
REPORT_FILE="${REPORT_FILE:-.amlog/qa/api-contract-report.json}"
TEST_FILTER="${CONTRACT_TEST_FILTER:-Category=Contract|Category=Api}"
DEPTH="${CONTRACT_DEPTH:-full}"
OUT_DIR="$(pwd)/.amlog/qa/contract"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.trx "$OUT_DIR"/breaking.txt "$OUT_DIR"/fuzz.log

build_report() {
  node "$SCRIPT_DIR/build-contract-report.js" --issue "$ISSUE_NUMBER" --depth "$DEPTH" \
    --started "$STARTED" --out "$REPORT_FILE" "$@"
}

if [ ! -d "$BACKEND_ROOT" ]; then
  echo "[api-contract] Back-end root '$BACKEND_ROOT' not found."
  build_report --exit 2 --notes "back-end root '$BACKEND_ROOT' not found"
  exit 2
fi
if ! command -v dotnet >/dev/null 2>&1; then
  echo "[api-contract] dotnet SDK not found on PATH."
  build_report --exit 2 --notes "dotnet SDK not found on PATH"
  exit 2
fi

# --- locate the OpenAPI spec --------------------------------------------------------------
SPEC="${OPENAPI_SPEC:-}"
if [ -z "$SPEC" ]; then
  SPEC="$(find "$BACKEND_ROOT" \( -name node_modules -o -name bin -o -name obj -o -name .git \) -prune -o \
    -type f \( -name 'swagger.json' -o -name 'openapi.json' -o -name 'openapi.yaml' -o -name 'openapi.yml' \) -print 2>/dev/null | head -n 1)"
fi
if [ -z "$SPEC" ] && [ -n "${BASE_URL:-}" ] && command -v curl >/dev/null 2>&1; then
  if curl -fsS "$BASE_URL/swagger/v1/swagger.json" -o "$OUT_DIR/swagger.json" 2>/dev/null; then
    SPEC="$OUT_DIR/swagger.json"
  fi
fi
NOTES=""
[ -z "$SPEC" ] && NOTES="no OpenAPI spec found (set OPENAPI_SPEC or BASE_URL) — breaking-change diff and fuzzing skipped"

# --- 1. dotnet contract / API tests -------------------------------------------------------
run_dotnet() {
  (cd "$BACKEND_ROOT" && dotnet test --filter "$TEST_FILTER" --logger "trx;LogFileName=$1" --results-directory "$OUT_DIR")
}

echo "[api-contract] ===== dotnet contract tests (filter: $TEST_FILTER) ====="
RETRY_FLAG=""
run_dotnet contract.trx
DOTNET_EXIT=$?
if [ $DOTNET_EXIT -ne 0 ] && [ -f "$OUT_DIR/contract.trx" ]; then
  echo "[api-contract] Contract tests failed — retrying once to separate flaky from failing..."
  if run_dotnet retry.trx; then
    RETRY_FLAG="--retry-passed"
    DOTNET_EXIT=0
  fi
fi

# --- 2. OpenAPI breaking changes vs base --------------------------------------------------
BREAKING_ARGS=()
if [ -n "$SPEC" ] && command -v oasdiff >/dev/null 2>&1; then
  REL="$(git -C "$BACKEND_ROOT" ls-files --full-name -- "$(cd "$(dirname "$SPEC")" && pwd)/$(basename "$SPEC")" 2>/dev/null)"
  if [ -n "$REL" ] && git -C "$BACKEND_ROOT" show "$BASE_BRANCH:$REL" > "$OUT_DIR/base-spec" 2>/dev/null; then
    echo "[api-contract] ===== OpenAPI breaking-change diff vs $BASE_BRANCH ====="
    oasdiff breaking "$OUT_DIR/base-spec" "$SPEC" --fail-on ERR > "$OUT_DIR/breaking.txt" 2>&1
    BREAKING_ARGS=(--breaking "$OUT_DIR/breaking.txt" --breaking-exit $?)
  else
    NOTES="${NOTES:+$NOTES; }spec is not tracked in git on $BASE_BRANCH — breaking-change diff skipped"
  fi
elif [ -n "$SPEC" ]; then
  NOTES="${NOTES:+$NOTES; }oasdiff not installed — breaking-change diff skipped"
fi

# --- 3. schema-driven fuzzing -------------------------------------------------------------
FUZZ_ARGS=()
if [ "${CONTRACT_FUZZ:-0}" = "1" ] && [ -n "$SPEC" ] && [ -n "${BASE_URL:-}" ]; then
  FUZZER="$(command -v schemathesis || command -v st || true)"
  if [ -n "$FUZZER" ]; then
    echo "[api-contract] ===== schema-driven fuzzing against $BASE_URL ====="
    "$FUZZER" run "$SPEC" --url "$BASE_URL" --checks all --max-examples 25 > "$OUT_DIR/fuzz.log" 2>&1
    FUZZ_ARGS=(--fuzz "$OUT_DIR/fuzz.log" --fuzz-exit $?)
  else
    NOTES="${NOTES:+$NOTES; }schemathesis not installed — fuzzing skipped"
  fi
fi

TRX_ARGS=()
[ -f "$OUT_DIR/contract.trx" ] && TRX_ARGS=(--trx "$OUT_DIR/contract.trx")

SUMMARY="$(build_report --exit "$DOTNET_EXIT" ${TRX_ARGS[@]+"${TRX_ARGS[@]}"} ${BREAKING_ARGS[@]+"${BREAKING_ARGS[@]}"} \
  ${FUZZ_ARGS[@]+"${FUZZ_ARGS[@]}"} $RETRY_FLAG ${NOTES:+--notes "$NOTES"})"
echo "[api-contract] $SUMMARY"

STATUS="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).status)" "$REPORT_FILE")"
case "$STATUS" in
  pass|flaky) exit 0 ;;
  fail)       exit 1 ;;
  no-tests)   exit 3 ;;
  *)          exit 2 ;;
esac
