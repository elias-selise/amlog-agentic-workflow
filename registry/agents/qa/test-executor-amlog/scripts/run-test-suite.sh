#!/usr/bin/env bash
# run-test-suite.sh — Run the full test suite for frontend and backend.
set -euo pipefail

FRONTEND_ROOT="${FRONTEND_ROOT:-../l3-angular-lim-business}"
BACKEND_ROOT="${BACKEND_ROOT:-../l3-net-lim-service}"
EXIT_CODE=0

echo "[test-executor] ===== Frontend Tests (Angular) ====="
if [ -d "$FRONTEND_ROOT" ]; then
  (cd "$FRONTEND_ROOT" && ng test --watch=false --code-coverage) || EXIT_CODE=1
else
  echo "[test-executor] WARNING: Frontend root '$FRONTEND_ROOT' not found, skipping."
fi

echo ""
echo "[test-executor] ===== Backend Tests (.NET) ====="
if [ -d "$BACKEND_ROOT" ]; then
  (cd "$BACKEND_ROOT" && dotnet test /p:CollectCoverage=true /p:CoverletOutputFormat=lcov) || EXIT_CODE=1
else
  echo "[test-executor] WARNING: Backend root '$BACKEND_ROOT' not found, skipping."
fi

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "[test-executor] ✅ All tests passed."
else
  echo "[test-executor] ❌ One or more tests failed. See output above."
fi

exit $EXIT_CODE
