# Usage Modes & Operational Guide

This guide documents every execution mode, CLI flag, editor feature, API route, and verification check in **App Store & Google Play Screenshots Generator**.

---

## Table of Contents

1. [Workflow Options: AI Agent Skill vs. Standalone](#1-workflow-options-ai-agent-skill-vs-standalone)
2. [Prerequisites & System Setup](#2-prerequisites--system-setup)
3. [Mode 1: Automated Capture Pipeline](#3-mode-1-automated-capture-pipeline)
4. [Mode 2: Manual Terminal Capture](#4-mode-2-manual-terminal-capture)
5. [Mode 3: Web Visual Editor & Live Snap](#5-mode-3-web-visual-editor--live-snap)
6. [Mode 4: Static Screenshots & Batch Reprocessing](#6-mode-4-static-screenshots--batch-reprocessing)
7. [Cross-Platform iOS / Android Sanitization](#7-cross-platform-ios--android-sanitization)
8. [Multiple iPhone Frames & Smart Auto-Selection](#8-multiple-iphone-frames--smart-auto-selection)
9. [Dual-Device Layouts & 2D Canvas Pull](#9-dual-device-layouts--2d-canvas-pull)
10. [Auto Theme, Presets & Copy Generation](#10-auto-theme-presets--copy-generation)
11. [MCP Server Integration](#11-mcp-server-integration)
12. [Editor REST API Reference](#12-editor-rest-api-reference)
13. [Troubleshooting & Verification Commands](#13-troubleshooting--verification-commands)

---

## 1. Workflow Options: AI Agent Skill vs. Standalone

### Option A: Universal AI Agent Skill (Run via AI Chat)

Install this project as a global skill across any major AI IDE or coding agent:

| Agent / Environment | Recommended Global Installation Path / Command |
|---|---|
| **Universal (skills.sh)** | `npx skills add https://github.com/Abdullatariq47/advance_screenshots.git` |
| **Claude Code** | `git clone https://github.com/Abdullatariq47/advance_screenshots.git ~/.claude/skills/advance-screenshots` |
| **Google Antigravity** | `git clone https://github.com/Abdullatariq47/advance_screenshots.git ~/.gemini/antigravity/skills/advance-screenshots` |
| **Cursor / Windsurf** | `git clone https://github.com/Abdullatariq47/advance_screenshots.git .agents/skills/advance-screenshots` |
| **OpenAI Codex** | Register in global Codex skills directory under `advance-screenshots` |

> [!TIP]
> **Isolating your skill from upstream:**
> Installing under the folder name `advance-screenshots` creates a dedicated, separate Git repository linked directly to your GitHub remote (`Abdullatariq47/advance_screenshots.git`). This guarantees that upstream updates to the original `app-store-screenshots` repository never overwrite or break your custom 2D drag, multi-frame bezels, or manual ADB capture logic. If you previously had `~/.claude/skills/app-store-screenshots`, you can safely keep both side-by-side or back up the old one and replace it.

#### Using the Skill in AI Chat
Once installed, interact with your AI agent naturally in chat:
- *"Capture screenshots of my app `com.example.app` from my connected Android phone and build App Store screenshots."*
- *"Run manual terminal capture so I can press `+` on specific screens."*
- *"Crop status bars, convert to iPhone 16 Pro frames, and launch the connected canvas editor."*
- *"Generate marketing headlines and export 6.9\" and 6.7\" bundles for App Store Connect."*

The AI agent will read `SKILL.md`, trigger the appropriate pipeline commands, handle image sanitization, derive marketing copy, and launch the web editor.

---

### Option B: Standalone / Manual Run (No AI Agent Needed)

For users who prefer running the tool directly from terminal or web browser without an AI agent:

```bash
# 1. Clone repository
git clone https://github.com/Abdullatariq47/advance_screenshots.git
cd advance_screenshots

# 2. Install dependencies
npm install
npm --prefix template install

# 3. Choose your manual mode:
npm run capture:manual -- --appId com.example.app  # Interactive terminal snapper [+]
npm run editor:dev                                # Web connected canvas (http://localhost:3000)
npm run pipeline                                  # Autonomous capture pipeline
npx tsx scripts/reprocess-existing-slides.ts <id> # Batch reprocess static images
```

---

## 2. Prerequisites & System Setup

- **Node.js** `>= 20.9.0` and `npm`
- **ADB (`adb`)** from Android SDK Platform-Tools (required only for live Android phone/emulator capture; detected automatically from `PATH`, `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`, `ANDROID_HOME`, or `ANDROID_SDK_ROOT`).
- **Optional `.env`** (copy `.env.example` to `.env`): Leave blank for local offline copy generation, or provide `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` for cloud vision copywriting.

Install dependencies once:

```bash
npm install
npm --prefix template install
```

Verify connected devices:

```bash
adb devices
```

---

## 2. Mode 1: Automated Capture Pipeline

Use Mode 1 when an Android phone or emulator is connected and you want the CLI to inspect the UI tree, navigate screens, capture screenshots, generate copy, detect your brand theme, and launch the visual editor automatically.

```bash
# Interactive setup wizard (detects device, active package, auth options, mode)
npm run pipeline

# Quick mode (uses existing pipeline.config.json without prompting)
npm run pipeline:quick

# Dry run (captures & generates JSON without booting localhost:3000)
npm run pipeline:dry
```

Configuration is stored in `pipeline.config.json` (see `pipeline.config.example.json`):

```json
{
  "app": {
    "platform": "android",
    "appId": "com.example.app",
    "auth": { "hasAuth": false, "hints": "" }
  },
  "captureMode": "manual",
  "captureGoals": [],
  "marketing": {
    "appName": "My App",
    "shortDescription": "Fast, intuitive mobile experience.",
    "themePreset": "clean-light",
    "accentColor": "#4F46E5"
  }
}
```

> Active `pipeline.config.json` and `projects/*` (except `.gitkeep`) are gitignored so workspace credentials and captures stay local.

---

## 3. Mode 2: Manual Terminal Capture

Use Mode 2 when **you** want to browse the app manually on your physical phone or emulator (handling logins, filters, scrolling, or dynamic modals) and snap specific screens at your own pace.

```bash
# Target a specific package ID directly (launches app & saves under projects/<appId>/)
npm run capture:manual -- --appId com.example.app

# Optional custom display name or capture-only mode (skips starting Next.js server)
npm run capture:manual -- --appId com.example.app --appName "My App" --captureOnly
```

### Supported CLI Flags (`scripts/manual-operator.ts`)

| Flag | Description |
|---|---|
| `--appId <package>` | Overrides `pipeline.config.json` `appId`, launches the app via ADB, and writes into `projects/<appId>/` |
| `--appName <name>` | Sets the deck display name (defaults to formatted `appId` or config `appName`) |
| `--config <path>` | Path to a custom `pipeline.config.json` |
| `--projectDir <path>` | Custom output project directory |
| `--captureOnly` | Captures images and metadata only (used when invoked by `run-pipeline.ts`) |

### Terminal Workflow

1. Choose `fresh` (clears old `slide-*.png` / `.xml` / `.meta.json` and starts at Slide 1) or `append`.
2. Navigate on your phone to the screen you want.
3. In the terminal, press **`+` + Enter** or **Enter** to snap (or optionally type a short screen label like `clients` + Enter to guide copy generation).
4. On every snap, `manual-operator.ts`:
   - Pulls `uiautomator` XML hierarchy (`slide-N.xml`) and extracts visible screen headings into `slide-N.meta.json`.
   - Captures `slide-N.png` via `adb shell screencap`.
   - Generates `slide-N-ios.png` (Android status bar stripped, iPhone `19.5:9` safe-area header + `9:41` status bar synthesized) and `slide-N-android.png`.
   - Syncs outputs to both `projects/<appId>/screenshots/` and `template/public/screenshots/`.
5. Type **`done`** (or `d`) when finished — `vision-copywriter.ts` generates copy from the captured UI metadata, `auto-theme-detector.ts` selects a matching color palette, and `http://localhost:3000` starts automatically (`q` cancels without modifying JSON).

---

## 4. Mode 3: Web Visual Editor & Live Snap

Start the editor anytime with:

```bash
npm run editor:dev
```

Open `http://localhost:3000`.

### Key Controls & Workflows

- **+ Snap Screen** (Toolbar / Sidebar): Snaps the live connected Android device right from your browser via `/api/capture-device`, creating iOS and Android assets and inserting a new slide onto the canvas immediately.
- **Connected vs Isolated Canvas**:
  - **Connected**: Phones, images, and decorative elements can cross adjacent screen splits; exports slice exact crops per screen.
  - **Isolated**: Each screen is self-contained with its own overflow clipping.
- **2D Drag & Magnetic Snapping**: Drag phones, captions, badges, and images freely horizontally and vertically (`dragAxis="both"`). Moving near a screen's horizontal center or the shared seam between adjacent screens gently snaps for alignment.
- **Dual-Device Layouts**: Switch any individual screen between `1 Device` and `2 Devices` in the right Inspector, then pick `Front Right`, `Front Left`, `Side by Side`, or `3D Stacked`, adjust Device Opacity (`40%–100%`), or swap primary/secondary screenshots.
- **Multiple iPhone Frames**: Switch deck-wide in the Toolbar or override per screen in the Inspector (`Auto (Smart Fit)`, `Clean Pro (No Notch)`, `Silver Titanium`, `Matte Studio`, `Dynamic Island`).
- **Auto Theme & App Presets**: Click `Auto Theme` to analyze your captures via `/api/auto-theme`, or pick from 7 built-in presets (`Yuka`, `Revolut`, `Linear`, `Blinkist`, `Duolingo`, `Airbnb`, `Raycast`).
- **Style Lab & Scene Playground**: Side-by-side look comparison with selective locking (Colors / Type / Layout / Scene) and global tuning for backdrop, glow, shadow, 3D tilt, headline scale, weight, and case.
- **Export Bundle**: Click **Export** -> select sizes or **Export bundle** to download a ZIP grouped by `platform/device/WxH/locale/`, written as opaque 24-bit RGB PNGs.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Z` / `Cmd+Z` | Undo (up to 50 steps) |
| `Ctrl+Y` / `Cmd+Shift+Z` | Redo |
| `ArrowDown` / `J` | Next screen |
| `ArrowUp` / `K` | Previous screen |
| `Escape` | Clear selection / blur active input |

---

## 5. Mode 4: Static Screenshots & Batch Reprocessing

If you already placed raw screenshots (`slide-1.png`, `slide-2.png`, ...) inside `projects/<appId>/screenshots/`:

```bash
npx tsx scripts/reprocess-existing-slides.ts <appId>
```

This regenerates all `slide-*-ios.png` and `slide-*-android.png` files, copies them to `template/public/screenshots/`, updates `template/app-store-screenshots.json`, and syncs back to `projects/<appId>/app-store-screenshots.json`.

---

## 6. Cross-Platform iOS / Android Sanitization

Handled by `scripts/system-bar-cropper.ts` (`processScreenshotCrossPlatform`):

- **Android target (`slide-*-android.png`)**: Preserves the native Android capture (or crops iPhone Dynamic Island & home bar if sourced from iOS via `cropIosForAndroid`).
- **iPhone target (`slide-*-ios.png`)**:
  1. Strips the Android status bar (`topCrop`, from UI XML bounds when present or `4%` height fallback) while keeping bottom in-app tabs intact.
  2. Samples the clean header band right below the Android bar and extends it seamlessly to match Apple's `iphone-portrait.png` cutout aspect (`1320 / 2868`, `1080×2347`), preventing black top/bottom letterbox padding.
  3. Composites an iOS status bar (`9:41` left, Cellular + Wi-Fi + Battery right) aligned to the Dynamic Island flanking ears, auto-colored `#111827` on light headers or `#FFFFFF` on dark headers.

---

## 7. Multiple iPhone Frames & Smart Auto-Selection

In `template/src/components/editor/device-frames.tsx`:

- **`auto` (`Auto (Smart Fit)`)** inspects a downsampled top strip of each loaded screenshot (`x: 33%–66%`, `y: 1.0%–6.2%` plus immediate under-island center clearance):
  - If logos or tight UI elements appear in or directly against the Dynamic Island zone, it automatically renders **`minimal-clean`** (Clean Pro · No Notch).
  - If the top-center safe area is clear, it renders **`dynamic-island`** (Apple `iphone-portrait.png` bezel).
- All 4 iPhone frames (`dynamic-island`, `minimal-clean`, `sleek-silver`, `clay-matte`) share identical exterior proportions and screen cutout coordinates (`1470:3000`, `L:5.10% T:2.20% W:89.80% H:95.60%`) so switching frames never shifts placements.

---

## 8. Dual-Device Layouts & 2D Canvas Pull

- Enable dual devices per screen from the Inspector (`1 Device` / `2 Devices`) without affecting other screens.
- Choose from 4 layouts: `Front Right` (`stagger-right`), `Front Left` (`stagger-left`), `Side by Side` (`side-by-side`), and `3D Stacked` (`stacked`).
- Use quick snap buttons in the Inspector (`Center`, `Shared Seam`) or drag freely across screen dividers in Connected Canvas mode.

---

## 9. Auto Theme, Presets & Copy Generation

- **Offline UI-Metadata Copywriter (`scripts/vision-copywriter.ts`)**: Reads captured UI XML metadata (`slide-*.meta.json`) or `captureGoals` and matches screen roles using word-boundary rules that ignore shared footer nav tabs.
- **Optional Cloud Vision APIs**: Setting `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` in `.env` sends a 720px JPEG preview to the configured provider for copy generation.

---

## 10. MCP Server Integration

Build and run the bundled mobile capture MCP server (`tools/mobile-capture-mcp/`):

```bash
npm run mcp:build
npm run mcp:start
```

---

## 11. Editor REST API Reference

Served by Next.js under `template/src/app/api/`:

| Route | Methods | Purpose |
|---|---|---|
| `/api/project` | `GET`, `POST` | Reads/writes `template/app-store-screenshots.json` with ETag conflict detection and validation |
| `/api/frames` | `GET` | Measures transparent screen cutouts and corner radii in `template/public/frames/*.png` |
| `/api/capture-device` | `POST` | Snaps live ADB device into `template/public/screenshots/` and generates iOS + Android assets |
| `/api/auto-theme` | `POST` | Analyzes screenshots in `template/public/screenshots/` and returns matched theme + full `Scene` |
| `/api/upload` | `POST` | Saves uploaded screenshots/assets into `template/public/screenshots/uploaded/<hash>.png` |
| `/api/upload-font` | `POST` | Stores licensed WOFF2/WOFF/TTF/OTF font files under `template/public/fonts/imported/` |
| `/api/export-to-project` | `POST` | Persists exported store PNGs back into the project workspace |

---

## 12. Troubleshooting & Verification Commands

Run verification before commits or releases:

```bash
# Type-check root CLI & capture scripts
npx tsc --noEmit

# Type-check and build the Next.js editor
npm --prefix template run typecheck
npm --prefix template run build

# Build the MCP capture server
npm run mcp:build
```

Common fixes:
- **Port 3000 already running**: Run `npm run server:kill`.
- **Stale screenshots in browser after re-snapping**: Hard-refresh (`Ctrl+Shift+R`); `image-cache.ts` also fetches with `cache: "no-store"`.
- **ADB device not listed**: Enable **USB Debugging** on Android, accept the RSA prompt on the device, and verify with `adb devices`.
