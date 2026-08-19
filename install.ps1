# install.ps1 — amlog-workflow installer for Windows (PowerShell)
# Usage: irm https://raw.githubusercontent.com/selise/amlog-agentic-workflow/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
$Package = "amlog-workflow"
$Binary = "amlog"

function Log($msg) { Write-Host "[amlog-install] $msg" -ForegroundColor Cyan }
function Err($msg) { Write-Host "[amlog-install] ERROR: $msg" -ForegroundColor Red; exit 1 }

Log "Installing $Package..."

# Require Node 18+
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Err "Node.js is required (>= 18). Install it from https://nodejs.org/"
}

$nodeVersion = (node -e "process.stdout.write(process.version)")
$nodeMajor = [int]($nodeVersion -replace "v(\d+)\..*", '$1')
if ($nodeMajor -lt 18) {
    Err "Node.js >= 18 is required. Found: $nodeVersion"
}

# Install via npm
if (Get-Command npm -ErrorAction SilentlyContinue) {
    Log "Installing via npm..."
    npm install -g $Package
    if ($LASTEXITCODE -ne 0) { Err "npm install failed." }
} else {
    Err "npm is not available. Please install Node.js from https://nodejs.org/"
}

# Verify installation
if (Get-Command $Binary -ErrorAction SilentlyContinue) {
    $v = & $Binary --version
    Log "✅ $Binary installed successfully: $v"
    Log ""
    Log "Next step — run inside your workspace:"
    Log "  amlog install --frontend    # for Angular devs"
    Log "  amlog install --backend     # for .NET devs"
    Log "  amlog install --qa          # for QA engineers"
    Log "  amlog install --ba          # for Business Analysts"
    Log "  amlog install --all         # for everyone"
} else {
    Err "Installation succeeded but '$Binary' not found on PATH. Restart your terminal and try again."
}
