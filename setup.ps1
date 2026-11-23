# ==============================================================================
# Advance Screenshots - Automated Environment Setup (Windows PowerShell)
# Idempotent: Safe to run repeatedly; automatically skips existing installations.
# ==============================================================================

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   Advance Screenshots - Developer Environment Setup   " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js and npm
$hasNode = Get-Command node -ErrorAction SilentlyContinue
$hasNpm = Get-Command npm -ErrorAction SilentlyContinue

if ($hasNode -and $hasNpm) {
    $nodeVer = node -v
    $npmVer = npm -v
    Write-Host "[✓] Node.js is already installed ($nodeVer) with npm ($npmVer). Skipping install." -ForegroundColor Green
} else {
    Write-Host "[!] Node.js not detected on PATH." -ForegroundColor Yellow
    $hasWinget = Get-Command winget -ErrorAction SilentlyContinue
    if ($hasWinget) {
        Write-Host "[*] Installing Node.js LTS automatically via winget..." -ForegroundColor Cyan
        winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
        # Refresh environment variables for the current session
        $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
        $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
        $env:Path = "$machinePath;$userPath"
    } else {
        Write-Host "[!] winget not found. Please download and install Node.js (v20+ LTS) manually from https://nodejs.org" -ForegroundColor Red
        exit 1
    }
}

# 2. Check Android ADB (Optional for mobile live capture)
$hasAdb = Get-Command adb -ErrorAction SilentlyContinue
if (-not $hasAdb) {
    $defaultAdb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools"
    if (Test-Path (Join-Path $defaultAdb "adb.exe")) {
        $env:Path += ";$defaultAdb"
        $hasAdb = $true
    }
}

if ($hasAdb) {
    $adbVer = (adb version 2>$null | Select-Object -First 1)
    Write-Host "[✓] Android Debug Bridge (ADB) detected: $adbVer" -ForegroundColor Green
} else {
    Write-Host "[i] ADB is not detected on PATH. (Only required if capturing live from an Android device)." -ForegroundColor Yellow
}

# 3. Install project dependencies
Write-Host ""
Write-Host "[*] Installing root pipeline scripts and dependencies..." -ForegroundColor Cyan
npm install --no-audit --no-fund

Write-Host ""
Write-Host "[*] Installing Next.js visual editor dependencies..." -ForegroundColor Cyan
npm --prefix template install --no-audit --no-fund

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "   Setup complete! You are ready to start.           " -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Quick Start Commands:" -ForegroundColor White
Write-Host "  1. Live Terminal Capture (Physical Device / Emulator):" -ForegroundColor Cyan
Write-Host "     npm run capture:manual -- --appId com.yourcompany.yourapp" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. Web Visual Editor (Connected 2D Canvas):" -ForegroundColor Cyan
Write-Host "     npm run editor:dev  ->  http://localhost:3000" -ForegroundColor Gray
Write-Host ""
