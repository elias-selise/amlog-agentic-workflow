#!/usr/bin/env bash
# run-affected-tests.sh — Run only the .NET tests affected by the current diff.
# Uses `codegraph affected` to determine impact, then runs those tests.
set -euo pipefail

BACKEND_ROOT="${BACKEND_ROOT:-../l3-net-lim-service}"

echo "[test-runner] Determining affected files..."

# Get affected files from CodeGraph
AFFECTED=$(codegraph affected --format=json 2>/dev/null || echo "[]")

if [ "$AFFECTED" = "[]" ]; then
  echo "[test-runner] No affected files detected. Running full test suite."
  (cd "$BACKEND_ROOT" && dotnet test)
  exit $?
fi

echo "[test-runner] Affected files:"
echo "$AFFECTED" | python3 -c "import sys,json; [print(' -', f) for f in json.load(sys.stdin)]"

# Map source files to test class names (convention: Foo.cs -> FooTests)
TEST_FILTER=$(echo "$AFFECTED" | python3 -c "
import sys, json, os
files = json.load(sys.stdin)
names = []
for f in files:
    base = os.path.splitext(os.path.basename(f))[0]
    names.append(base + 'Tests')
print('|'.join(names))
")

echo "[test-runner] Running affected tests: $TEST_FILTER"
(cd "$BACKEND_ROOT" && dotnet test --filter "FullyQualifiedName~$TEST_FILTER")

echo "[test-runner] Affected tests complete."
