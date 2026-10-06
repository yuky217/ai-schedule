# setup.ps1 - prepare the local environment for this project.
#
# Why this file exists
# --------------------
# This project needs a handful of machine-level settings that are NOT in the
# repository: where npm keeps its cache, where Expo keeps its state, telemetry
# off, and a .env flag that keeps the expo-sqlite web worker in the bundle.
# They used to live only in the developer's head, which meant every new machine
# turned into an hour of "why is the web dev server broken".
#
# The script keeps everything heavy NEXT TO the project directory (not in the
# project, not on the system drive), so it adapts to any machine:
#
#   <parent>/.npm-cache    npm cache
#   <parent>/.expo-home    HOME / USERPROFILE for Expo (it writes .expo there)
#
# Usage
# -----
#   powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -SkipInstall
#
# NOTE: this file is intentionally ASCII-only. Windows PowerShell 5.1 reads
# BOM-less .ps1 files as ANSI, so non-ASCII text here would come out garbled.

param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$WorkRoot    = Split-Path -Parent $ProjectRoot
$NpmCache    = Join-Path $WorkRoot '.npm-cache'
$ExpoHome    = Join-Path $WorkRoot '.expo-home'

Write-Host ""
Write-Host "ai-schedule setup"
Write-Host "  project : $ProjectRoot"
Write-Host "  work dir: $WorkRoot"
Write-Host ""

# 1) Node -----------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js not found in PATH. Install Node 22 first.' }
Write-Host ("  node    : " + (& node --version))

# 2) Directories ----------------------------------------------------------
foreach ($dir in @($NpmCache, $ExpoHome)) {
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Write-Host "  created : $dir"
  } else {
    Write-Host "  ok      : $dir"
  }
}

# 3) .env -----------------------------------------------------------------
# Metro's lazy bundling leaves the expo-sqlite web worker out of the dev graph,
# which surfaces as "Worker chunk not found" on the first web load.
$envFile = Join-Path $ProjectRoot '.env'
if (-not (Test-Path $envFile)) {
  @(
    '# Keep the expo-sqlite web worker in the Metro dev graph',
    '# (otherwise web dev fails with "Worker chunk not found").',
    'EXPO_NO_METRO_LAZY=1',
    'EXPO_NO_TELEMETRY=1'
  ) | Set-Content -Path $envFile -Encoding ASCII
  Write-Host "  created : $envFile"
} else {
  Write-Host "  ok      : $envFile (kept as is)"
}

# 4) Session variables ----------------------------------------------------
# These must be set in EVERY shell before running expo / tsc / vitest.
$env:npm_config_cache  = $NpmCache
$env:HOME              = $ExpoHome
$env:USERPROFILE       = $ExpoHome
$env:EXPO_NO_TELEMETRY = '1'

# 5) Dependencies ---------------------------------------------------------
if (-not $SkipInstall) {
  Push-Location $ProjectRoot
  try {
    if (Test-Path (Join-Path $ProjectRoot 'package-lock.json')) {
      Write-Host "  installing (npm ci) ..."
      npm ci
    } else {
      Write-Host "  installing (npm install) ..."
      npm install
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Host "  skipped : dependency install"
}

Write-Host ""
Write-Host "Done. In every new shell, set these before running expo:"
Write-Host ""
Write-Host "  `$env:npm_config_cache  = '$NpmCache'"
Write-Host "  `$env:HOME              = '$ExpoHome'"
Write-Host "  `$env:USERPROFILE       = '$ExpoHome'"
Write-Host "  `$env:EXPO_NO_TELEMETRY = '1'"
Write-Host ""
Write-Host "Then:"
Write-Host "  npx expo start        # dev server (scan the QR code with Expo Go)"
Write-Host "  npm test              # domain unit tests (vitest)"
Write-Host "  npm run typecheck     # tsc --noEmit"
Write-Host ""
Write-Host "Export build output OUTSIDE the project directory, e.g.:"
Write-Host "  npx expo export --platform web --output-dir ../.build-check/web"
Write-Host ""
