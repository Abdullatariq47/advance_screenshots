// scripts/adb-navigation-watcher.ts
import { spawn, ChildProcess, execSync } from "child_process";
import { EventEmitter } from "events";

export class AdbNavigationWatcher extends EventEmitter {
  private adbCmd: string;
  private logcatProcess: ChildProcess | null = null;
  private isListening = false;
  private lastEventTimestamp = 0;

  constructor(adbCmd: string) {
    super();
    this.adbCmd = adbCmd.replace(/^"|"$/g, "");
  }

  /**
   * Starts real-time streaming of Android WindowManager, ActivityTaskManager, and View drawing events.
   */
  public start(): void {
    if (this.isListening) return;

    try {
      // Clear previous logcat buffer so only fresh events trigger
      execSync(`"${this.adbCmd}" logcat -c`, { stdio: "ignore" });
    } catch {}

    const args = [
      "shell",
      "logcat",
      "-v",
      "brief",
      "-b",
      "events",
      "-b",
      "main",
      "-s",
      "ActivityTaskManager:I",
      "WindowManager:I",
      "ViewRootImpl:D",
      "SurfaceFlinger:I",
      "flutter:I",
      "InputMethodManager:I"
    ];

    try {
      this.logcatProcess = spawn(this.adbCmd, args, { stdio: ["ignore", "pipe", "ignore"] });
      this.isListening = true;

      if (this.logcatProcess.stdout) {
        this.logcatProcess.stdout.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          const lines = text.split("\n");

          for (const line of lines) {
            if (this.isNavigationLine(line)) {
              this.lastEventTimestamp = Date.now();
              this.emit("navigation", { line, timestamp: this.lastEventTimestamp });
            }
          }
        });
      }

      this.logcatProcess.on("error", () => {
        this.isListening = false;
      });

      this.logcatProcess.on("exit", () => {
        this.isListening = false;
      });
    } catch {
      this.isListening = false;
    }
  }

  /**
   * Identifies system lines that indicate screen display, drawing, or activity transitions.
   */
  private isNavigationLine(line: string): boolean {
    return (
      line.includes("am_displayed") ||
      line.includes("am_activity_fully_drawn") ||
      line.includes("Displayed com.") ||
      line.includes("relayoutWindow") ||
      line.includes("Focus entering window") ||
      line.includes("finishDrawing") ||
      line.includes("I/flutter") ||
      line.includes("ActiveConfigToHWC") ||
      line.includes("submitDisplayConfig") ||
      line.includes("finalizeDisplayModeChange")
    );
  }

  /**
   * Executes an action (e.g. tap or launch) and resolves immediately when the Android
   * navigation event triggers, eliminating unnecessary sleep wait.
   */
  public async executeAndWaitForNavigation(
    action: () => void | Promise<void>,
    minSettleMs = 350,
    maxTimeoutMs = 12000
  ): Promise<boolean> {
    if (!this.isListening) {
      this.start();
    }

    const markTimestamp = Date.now();
    let navigated = false;

    const onNav = () => {
      navigated = true;
    };

    this.once("navigation", onNav);

    // Execute the action (e.g. tap)
    await Promise.resolve(action());

    // Wait for the instant reactive event or timeout
    const startTime = Date.now();
    while (Date.now() - startTime < maxTimeoutMs) {
      if (navigated || this.lastEventTimestamp >= markTimestamp) {
        this.removeListener("navigation", onNav);
        // Small buffer to allow Flutter paint to flush to framebuffer
        if (minSettleMs > 0) {
          await new Promise(r => setTimeout(r, minSettleMs));
        }
        return true;
      }
      await new Promise(r => setTimeout(r, 60)); // Fast 60ms reactive loop
    }

    this.removeListener("navigation", onNav);
    return false;
  }

  /**
   * Cleanly stop logcat listener.
   */
  public stop(): void {
    if (this.logcatProcess) {
      try {
        this.logcatProcess.kill();
      } catch {}
      this.logcatProcess = null;
    }
    this.isListening = false;
    this.removeAllListeners();
  }
}
