# Credits, Attribution & Licenses

## Original Creator & Foundation

- **[Parth Jadhav](https://www.parthjadhav.com/)** — Creator of the original [`app-store-screenshots`](https://www.skills.sh/parthjadhav/app-store-screenshots/app-store-screenshots) connected-canvas Next.js editor and skill architecture, released under the [MIT License](LICENSE).

## Platform Hardware Bezels & Guidelines

- **Apple Design Resources (Apple Inc.)** — Official product bezels bundled under `template/public/frames/` (`iphone-portrait.png`, `ipad-portrait.png`, `watch.png`, `tv.png`, `mac.png`, `duo-outer-*`, `duo-inner-*`). Per Apple's license terms, Apple product bezels may only be used to create marketing mock-ups of applications built for Apple platforms.
- **Google Play Store Assets** — Programmatic Android phone, 7" tablet, 10" tablet, and 1024×500 feature-graphic frames conform to Google Play Store asset specifications (24-bit opaque RGB PNG output).

## Mobile Capture & Editor Extensions

- **Device Capture & Sanitization Pipeline** (`scripts/` & `tools/mobile-capture-mcp/`):
  - ADB capture automation (`agent-executor.ts`), UI hierarchy inspection (`ui-inspector.ts`), and interactive terminal capture (`manual-operator.ts`).
  - Cross-platform status/navigation bar sanitization and iPhone Dynamic Island safe-area synthesis (`system-bar-cropper.ts`).
  - Multi-frame iPhone hardware rendering (`device-frames.tsx` — `auto`, `minimal-clean`, `sleek-silver`, `clay-matte`, `dynamic-island`).
  - Local UI-metadata semantic copywriter (`vision-copywriter.ts`), palette/scene matcher (`auto-theme-detector.ts`), and MCP capture server (`tools/mobile-capture-mcp`).

## Open-Source Stack

| Package | Role | License |
|---|---|---|
| [Next.js](https://nextjs.org/) & [React](https://react.dev/) | Editor shell, API routes, and App Router | MIT |
| [TypeScript](https://www.typescriptlang.org/) | Static type checking across scripts and editor | Apache-2.0 |
| [Tailwind CSS](https://tailwindcss.com/) | Utility-first editor styling | MIT |
| [Radix UI](https://www.radix-ui.com/) & [shadcn/ui](https://ui.shadcn.com/) | Accessible dialogs, selects, tabs, and tooltips | MIT |
| [Lucide Icons](https://lucide.dev/) | Vector editor UI iconography | ISC |
| [sharp](https://sharp.pixelplumbing.com/) | Image cropping, compositing, and safe-area rendering | Apache-2.0 |
| [html-to-image](https://github.com/bubkoo/html-to-image) | High-DPI PNG canvas rendering | MIT |
| [react-rnd](https://github.com/bokuweb/react-rnd) | Free 2D drag, cross-screen pull, and resize handles | MIT |
| [dnd-kit](https://dndkit.com/) | Drag-and-drop screen reordering | MIT |
| [JSZip](https://stuk.github.io/jszip/) | Store-ready ZIP bundle packaging | MIT / GPLv3 |
| [Sonner](https://sonner.emilkowal.ski/) | Toast notifications | MIT |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MCP server integration | MIT |

## Optional Vision API Providers

When API keys are optionally configured in `.env` (not required for offline use):
- **Anthropic Vision API** (`ANTHROPIC_API_KEY`)
- **OpenAI Vision API** (`OPENAI_API_KEY`)
- **Google Gemini Vision API** (`GEMINI_API_KEY` / `GOOGLE_API_KEY`)
