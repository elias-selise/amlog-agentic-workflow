#!/usr/bin/env bash
# launch-browser.sh — Start the Angular dev server and open the app in a browser.
# Run from within the l3-angular-lim-business project root.
set -euo pipefail

ANGULAR_ROOT="${ANGULAR_ROOT:-../l3-angular-lim-business}"
PORT="${PORT:-4200}"

echo "[browser-launcher] Starting Angular dev server on port $PORT..."

# Start ng serve in background
(cd "$ANGULAR_ROOT" && ng serve --port "$PORT" &)
NG_PID=$!

# Wait for the server to be ready
echo "[browser-launcher] Waiting for server to start..."
for i in {1..30}; do
  if curl -s "http://localhost:$PORT" >/dev/null 2>&1; then
    echo "[browser-launcher] Server ready at http://localhost:$PORT"
    break
  fi
  sleep 1
done

# Open in default browser
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:$PORT"
elif command -v open >/dev/null 2>&1; then
  open "http://localhost:$PORT"
else
  echo "[browser-launcher] Please open http://localhost:$PORT in your browser."
fi

echo "[browser-launcher] Server running (PID $NG_PID). Press Ctrl+C to stop."
wait $NG_PID
