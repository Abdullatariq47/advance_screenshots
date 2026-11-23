#!/usr/bin/env bash
# ==============================================================================
# Advance Screenshots - Automated Environment Setup (macOS / Linux)
# Idempotent: Safe to run repeatedly; automatically skips existing installations.
# ==============================================================================

set -e

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}=====================================================${RESET}"
echo -e "${BOLD}${CYAN}   Advance Screenshots - Developer Environment Setup   ${RESET}"
echo -e "${BOLD}${CYAN}=====================================================${RESET}"
echo ""

# 1. Check Node.js and npm
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    NODE_VERSION=$(node -v)
    NPM_VERSION=$(npm -v)
    echo -e "${GREEN}[✓] Node.js is already installed (${NODE_VERSION}) with npm (${NPM_VERSION}). Skipping install.${RESET}"
else
    echo -e "${YELLOW}[!] Node.js not detected on PATH.${RESET}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew >/dev/null 2>&1; then
            echo -e "${CYAN}Installing Node.js via Homebrew...${RESET}"
            brew install node
        else
            echo -e "${YELLOW}Homebrew not found. Please install Homebrew or Node.js manually from https://nodejs.org${RESET}"
            exit 1
        fi
    elif command -v apt-get >/dev/null 2>&1; then
        echo -e "${CYAN}Installing Node.js via apt...${RESET}"
        sudo apt-get update && sudo apt-get install -y nodejs npm
    else
        echo -e "${YELLOW}Please install Node.js (v20+ recommended) from https://nodejs.org${RESET}"
        exit 1
    fi
fi

# 2. Check Mobile Device Bridge Tools
if [[ "$OSTYPE" == "darwin"* ]]; then
    if command -v xcrun >/dev/null 2>&1; then
        echo -e "${GREEN}[✓] Xcode tools (xcrun simctl) detected for iOS Simulator.${RESET}"
    fi
    if command -v idevicescreenshot >/dev/null 2>&1; then
        echo -e "${GREEN}[✓] libimobiledevice detected for physical iPhone capture.${RESET}"
    else
        echo -e "${YELLOW}[i] Tip: For physical iPhone USB capture on macOS, run: brew install libimobiledevice${RESET}"
    fi
fi

if command -v adb >/dev/null 2>&1; then
    ADB_VERSION=$(adb version 2>/dev/null | head -n 1)
    echo -e "${GREEN}[✓] Android Debug Bridge (ADB) detected: ${ADB_VERSION}${RESET}"
else
    echo -e "${YELLOW}[i] ADB is not on your PATH. (Only required if capturing live from an Android device).${RESET}"
fi

# 3. Install project dependencies
echo ""
echo -e "${CYAN}[*] Installing root pipeline scripts and dependencies...${RESET}"
npm install --no-audit --no-fund

echo ""
echo -e "${CYAN}[*] Installing Next.js visual editor dependencies...${RESET}"
npm --prefix template install --no-audit --no-fund

echo ""
echo -e "${BOLD}${GREEN}=====================================================${RESET}"
echo -e "${BOLD}${GREEN}   Setup complete! You are ready to start.           ${RESET}"
echo -e "${BOLD}${GREEN}=====================================================${RESET}"
echo ""
echo -e "Quick Start Commands:"
echo -e "  ${BOLD}1. Live Terminal Capture (Physical Device / Emulator):${RESET}"
echo -e "     npm run capture:manual -- --appId com.yourcompany.yourapp"
echo ""
echo -e "  ${BOLD}2. Web Visual Editor (Connected 2D Canvas):${RESET}"
echo -e "     npm run editor:dev  ->  http://localhost:3000"
echo ""
