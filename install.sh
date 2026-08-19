#!/usr/bin/env sh
# install.sh — amlog-workflow installer for macOS and Linux.
# Usage: curl -fsSL https://raw.githubusercontent.com/selise/amlog-workflow/main/install.sh | sh
set -e

PACKAGE="amlog-workflow"
BINARY="amlog"

log() { printf '\033[1;36m[amlog-install]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[amlog-install] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

log "Installing $PACKAGE..."

# Require Node 18+
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is required (>= 18). Install it from https://nodejs.org/"
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.version.split('.')[0].replace('v',''))")
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js >= 18 is required. Found: $(node --version)"
fi

# Install via npm
if command -v npm >/dev/null 2>&1; then
  log "Installing via npm..."
  npm install -g "$PACKAGE"
elif command -v npx >/dev/null 2>&1; then
  log "npm not found. You can still run: npx $PACKAGE"
  exit 0
else
  err "npm is not available. Please install Node.js from https://nodejs.org/"
fi

# Verify installation
if command -v "$BINARY" >/dev/null 2>&1; then
  log "✅ $BINARY installed successfully: $(amlog --version)"
  log ""
  log "Next step — run inside your workspace:"
  log "  amlog install --frontend    # for Angular devs"
  log "  amlog install --backend     # for .NET devs"
  log "  amlog install --qa          # for QA engineers"
  log "  amlog install --ba          # for Business Analysts"
  log "  amlog install --all         # for everyone"
else
  err "Installation succeeded but '$BINARY' not found on PATH. Try: export PATH=\"\$(npm root -g)/.bin:\$PATH\""
fi
