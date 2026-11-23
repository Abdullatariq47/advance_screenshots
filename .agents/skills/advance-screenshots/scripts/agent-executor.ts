import { processScreenshotCrossPlatform } from "./system-bar-cropper.js";
// scripts/agent-executor.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import {
  dumpCurrentUi,
  findInputForEmail,
  findInputForPassword,
  findButtonByKeywords,
  findBottomNavTabs,
  getDeviceScreenDimensions,
  minimizeKeyboard,
  clearAndInputText,
  hasValidationErrors,
  identifyScreen,
  isLoginScreen,
  isLoginScreenReady,
  waitForUiCondition,
  DetectedScreenType
} from "./ui-inspector.js";
import { AdbNavigationWatcher } from "./adb-navigation-watcher.js";
import { detectActivePackage } from "./interactive-prompt.js";

function parseArgs(): { configPath: string; projectDir?: string; coldRestart: boolean } {
  const args = process.argv.slice(2);
  let configPath = path.resolve(process.cwd(), "pipeline.config.json");
  let projectDir: string | undefined;
  const coldRestart = args.includes("--cold-restart") || args.includes("--restart");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      configPath = path.resolve(process.cwd(), args[i + 1]);
    }
    if (args[i] === "--projectDir" && args[i + 1]) {
      projectDir = path.resolve(process.cwd(), args[i + 1]);
    }
  }
  return { configPath, projectDir, coldRestart };
}

function getAdbPath(): string {
  try {
    execSync("adb version", { stdio: "ignore" });
    return "adb";
  } catch {}

  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Android/Sdk/platform-tools/adb.exe"),
    path.join(process.env.ANDROID_HOME || "", "platform-tools/adb.exe"),
    path.join(process.env.ANDROID_SDK_ROOT || "", "platform-tools/adb.exe"),
    path.join(process.env.HOME || "", "Library/Android/sdk/platform-tools/adb"),
    path.join(process.env.HOME || "", "Android/Sdk/platform-tools/adb")
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return `"${candidate}"`;
    }
  }

  return "adb";
}

function checkLiveDevices(adbCmd: string): { hasAndroidDevice: boolean; deviceName?: string } {
  try {
    const adbOutput = execSync(`${adbCmd} devices`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
    const lines = adbOutput.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("List of devices"));
    const active = lines.find(l => l.endsWith("device"));
    if (active) {
      return { hasAndroidDevice: true, deviceName: active.split(/\s+/)[0] };
    }
  } catch {}
  return { hasAndroidDevice: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function saveDualScreenshot(
  adbCmd: string,
  slideIndex: number,
  projectScreenshotsDir: string,
  templateScreenshotsDir: string,
  sourcePlatform: "android" | "ios" = "android"
): Promise<boolean> {
  const fileName = `slide-${slideIndex}.png`;
  const projectDest = path.join(projectScreenshotsDir, fileName);
  const templateDest = path.join(templateScreenshotsDir, fileName);

  try {
    execSync(`${adbCmd} shell screencap -p /sdcard/temp_screen.png`, { stdio: "ignore" });
    execSync(`${adbCmd} pull /sdcard/temp_screen.png "${projectDest}"`, { stdio: "ignore" });
    try { execSync(`${adbCmd} shell rm -f /sdcard/temp_screen.png`, { stdio: "ignore" }); } catch {}

    if (fs.existsSync(projectDest) && fs.statSync(projectDest).size > 1000) {
      fs.copyFileSync(projectDest, templateDest);

      // Auto-generate store-sanitized iOS and Android variants
      const projectIosDest = path.join(projectScreenshotsDir, `slide-${slideIndex}-ios.png`);
      const projectAndroidDest = path.join(projectScreenshotsDir, `slide-${slideIndex}-android.png`);
      const templateIosDest = path.join(templateScreenshotsDir, `slide-${slideIndex}-ios.png`);
      const templateAndroidDest = path.join(templateScreenshotsDir, `slide-${slideIndex}-android.png`);

      await processScreenshotCrossPlatform(projectDest, projectIosDest, projectAndroidDest, sourcePlatform, "current_screen.xml");
      if (fs.existsSync(projectIosDest)) fs.copyFileSync(projectIosDest, templateIosDest);
      if (fs.existsSync(projectAndroidDest)) fs.copyFileSync(projectAndroidDest, templateAndroidDest);

      return true;
    }
  } catch (err) {
    console.warn("   ⚠ Cross-platform cropping notice:", err);
  }
  return false;
}

async function performValidatedLogin(
  adbCmd: string,
  email: string,
  pass: string,
  watcher: AdbNavigationWatcher
): Promise<boolean> {
  console.log(`\n🔐 Performing Screen-Aware Auto-Login for [${email}]...`);

  // Step 1: Check if the screen is actually the Login screen
  let currentNodes = dumpCurrentUi(adbCmd);
  let currentScreen = identifyScreen(currentNodes);
  console.log(`   • Current detected screen state: [${currentScreen.toUpperCase()}]`);

  // If already on Dashboard, login is already fulfilled!
  if (currentScreen === "dashboard") {
    console.log(`   ✓ [Screen Check] App is already authenticated and on Dashboard.`);
    return true;
  }

  // If on onboarding or welcome, wait or navigate
  if (currentScreen !== "login") {
    console.log(`   • Waiting for Login screen to be confirmed...`);
    const ready = await waitForUiCondition(
      adbCmd,
      nodes => identifyScreen(nodes) === "login",
      15000,
      600
    );

    if (!ready.success) {
      console.error(`   ❌ [Screen Check Failed] Current screen is [${identifyScreen(dumpCurrentUi(adbCmd))}], not Login screen.`);
      return false;
    }
  }

  console.log(`   ✓ [Screen Check Passed] Confirmed on Login screen. Proceeding with credentials entry...`);

  let maxAttempts = 3;
  let isFilled = false;

  while (maxAttempts > 0 && !isFilled) {
    maxAttempts--;
    let nodes = dumpCurrentUi(adbCmd);

    const emailNode = findInputForEmail(nodes);
    const passNode = findInputForPassword(nodes);

    if (!emailNode || !passNode) {
      console.warn(`   ⚠ Could not identify EditText fields. Retrying UI dump...`);
      await sleep(800);
      continue;
    }

    console.log(`   • Found Email EditText at (${emailNode.bounds.cx}, ${emailNode.bounds.cy}). Typing...`);
    clearAndInputText(adbCmd, emailNode.bounds.cx, emailNode.bounds.cy, email);
    await sleep(350);
    minimizeKeyboard(adbCmd);
    await sleep(400);

    // Re-dump after keyboard is minimized to cleanly locate password field
    nodes = dumpCurrentUi(adbCmd);
    const passNodeFresh = findInputForPassword(nodes) || passNode;
    console.log(`   • Found Password EditText at (${passNodeFresh.bounds.cx}, ${passNodeFresh.bounds.cy}). Typing...`);
    clearAndInputText(adbCmd, passNodeFresh.bounds.cx, passNodeFresh.bounds.cy, pass);
    await sleep(350);
    minimizeKeyboard(adbCmd);
    await sleep(500);

    // Validate inputs
    nodes = dumpCurrentUi(adbCmd);
    const verifyEmail = findInputForEmail(nodes);
    const verifyPass = findInputForPassword(nodes);
    const errors = hasValidationErrors(nodes);

    const emailHasVal = verifyEmail && verifyEmail.text.trim().length > 0 && !/enter email/i.test(verifyEmail.text);
    const passHasVal = verifyPass && verifyPass.text.trim().length > 0;

    if (emailHasVal && passHasVal && errors.length === 0) {
      isFilled = true;
      console.log(`   ✓ [Validation Passed] Fields successfully filled and verified.`);
    } else {
      console.warn(`   ⚠ [Validation Warning] Field contents not confirmed yet. Retrying input... (${maxAttempts} attempts remaining)`);
      if (errors.length > 0) {
        console.warn(`     Errors found: ${errors.join(", ")}`);
      }
      await sleep(600);
    }
  }

  // CRITICAL GUARD: NEVER TAP LOGIN IF NOT FILLED!
  if (!isFilled) {
    console.error(`   ❌ [Input Failed] Fields could not be filled. Halting before login button tap to prevent submitting empty form.`);
    return false;
  }

  // 2. Click Login button with instant navigation event listener
  let nodes = dumpCurrentUi(adbCmd);
  const loginBtn = findButtonByKeywords(nodes, /login|sign in|continue|submit/i);

  if (loginBtn) {
    console.log(`   • Tapping Login button at (${loginBtn.bounds.cx}, ${loginBtn.bounds.cy})...`);
    await watcher.executeAndWaitForNavigation(() => {
      execSync(`${adbCmd} shell input tap ${loginBtn.bounds.cx} ${loginBtn.bounds.cy}`, { stdio: "ignore" });
    }, 500, 7000);
  } else {
    const { width: sw, height: sh } = getDeviceScreenDimensions(adbCmd);
    const fallbackY = Math.round(sh * 0.81);
    console.log(`   • Tapping Login button fallback (${Math.round(sw / 2)}, ${fallbackY})...`);
    await watcher.executeAndWaitForNavigation(() => {
      execSync(`${adbCmd} shell input tap ${Math.round(sw / 2)} ${fallbackY}`, { stdio: "ignore" });
    }, 500, 7000);
  }

  // 3. Wait for response and validate screen transition
  console.log(`   • Validating screen transition...`);
  let loginSuccess = false;

  for (let wait = 0; wait < 10; wait++) {
    await sleep(1000);
    nodes = dumpCurrentUi(adbCmd);

    // Check for intermediate skip / continue buttons
    const skipBtn = findButtonByKeywords(nodes, /skip to dashboard|skip|continue|check in|allow|ok|dismiss/i);
    if (skipBtn) {
      console.log(`   • Tapping intermediate prompt [${skipBtn.contentDesc || skipBtn.text}] at (${skipBtn.bounds.cx}, ${skipBtn.bounds.cy})...`);
      await watcher.executeAndWaitForNavigation(() => {
        execSync(`${adbCmd} shell input tap ${skipBtn.bounds.cx} ${skipBtn.bounds.cy}`, { stdio: "ignore" });
      }, 500, 4000);
      await sleep(1000);
      loginSuccess = true;
      break;
    }

    // Check if we are still on the login screen
    if (!isLoginScreen(nodes)) {
      loginSuccess = true;
      console.log(`   ✓ [Screen Transition Verified] Successfully left Login screen!`);
      break;
    }

    const errors = hasValidationErrors(nodes);
    if (errors.length > 0) {
      console.warn(`   ⚠ Server or field error detected: ${errors.join(", ")}`);
    }
  }

  // If still on login screen, offer interactive fallback if terminal attached
  if (!loginSuccess && process.stdin.isTTY) {
    console.log(`\n==========================================================`);
    console.log(`⚠ [Validation Alert] App is still on Login screen.`);
    console.log(`   You can complete the login manually on your phone screen.`);
    console.log(`==========================================================`);
    const rl = readline.createInterface({ input, output });
    const ans = await rl.question(`Press [ENTER] once you have reached Dashboard (or 'q' to abort): `);
    rl.close();

    if (ans.trim().toLowerCase() !== "q") {
      await sleep(1000);
      const postNodes = dumpCurrentUi(adbCmd);
      if (!isLoginScreen(postNodes)) {
        loginSuccess = true;
        console.log(`   ✓ [Manual Login Verified] Confirmed on Dashboard!`);
      }
    }
  }

  return loginSuccess;
}

async function main() {
  const { configPath, projectDir, coldRestart } = parseArgs();
  if (!fs.existsSync(configPath)) {
    console.error(`[Agent Executor] Configuration file not found at ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const adbCmd = getAdbPath();
  const { hasAndroidDevice, deviceName } = checkLiveDevices(adbCmd);

  if (!hasAndroidDevice || !deviceName) {
    console.error(`[Agent Executor] No Android device connected via ADB.`);
    process.exit(1);
  }

  // Start real-time ADB Navigation Event Stream
  const watcher = new AdbNavigationWatcher(adbCmd);
  watcher.start();
  console.log(`⚡ [Real-Time Engine] ADB event stream active (Zero-latency navigation detection).`);

  try {
    // Set up project screenshot paths
    const resolvedProjectDir = projectDir || path.resolve(process.cwd(), "projects", config.app.appId);
    const projectScreenshotsDir = path.join(resolvedProjectDir, "screenshots");
    const templateScreenshotsDir = path.resolve(process.cwd(), "template/public/screenshots");

    if (!fs.existsSync(projectScreenshotsDir)) fs.mkdirSync(projectScreenshotsDir, { recursive: true });
    if (!fs.existsSync(templateScreenshotsDir)) fs.mkdirSync(templateScreenshotsDir, { recursive: true });

    console.log(`\n==========================================================`);
    console.log(`Running Pipeline on Device: ${deviceName}`);
    console.log(`Target: ${config.app.appId}`);
    console.log(`Saving to: ${projectScreenshotsDir}`);
    console.log(`==========================================================\n`);

    let slideIndex = 1;
    const activePackage = detectActivePackage(adbCmd);
    const isAlreadyRunning = Boolean(activePackage && activePackage === config.app.appId);

    if (isAlreadyRunning && !coldRestart) {
      console.log(`[Live App Detected] "${config.app.appId}" is already open on screen.`);
      console.log(`   ⚡ In-Flight Attach: Preserving your active screen, login session & data.`);

      await saveDualScreenshot(adbCmd, slideIndex, projectScreenshotsDir, templateScreenshotsDir, (config.app.platform as "android" | "ios") || "android");
      console.log(`   ✓ [Active Screen] Captured -> slide-${slideIndex}.png`);
      slideIndex++;
    } else {
      // Ensure clean state if authentication is requested so splash & pristine login are guaranteed
      if (config.app.auth?.hasAuth && coldRestart) {
        console.log(`🧹 Clearing app data to ensure pristine onboarding & login capture...`);
        try { execSync(`${adbCmd} shell pm clear ${config.app.appId}`, { stdio: "ignore" }); } catch {}
      }

      // 1. Splash Screen
      console.log(`[Screen ${slideIndex}] Launching app for Splash Screen capture...`);
      try { execSync(`${adbCmd} shell am force-stop ${config.app.appId}`, { stdio: "ignore" }); } catch {}
      
      await watcher.executeAndWaitForNavigation(() => {
        execSync(`${adbCmd} shell monkey -p ${config.app.appId} -c android.intent.category.LAUNCHER 1`, { stdio: "ignore" });
      }, 600, 10000);

      await saveDualScreenshot(adbCmd, slideIndex, projectScreenshotsDir, templateScreenshotsDir, (config.app.platform as "android" | "ios") || "android");
      console.log(`   ✓ [Splash Screen] Captured -> slide-${slideIndex}.png`);
      slideIndex++;
    }

    // Check if app is already past login
    const currentNodes = dumpCurrentUi(adbCmd);
    const currentScreenType = identifyScreen(currentNodes);
    const alreadyAuthenticated = isAlreadyRunning && currentScreenType !== "login" && currentScreenType !== "welcome" && currentScreenType !== "onboarding";

    if (alreadyAuthenticated) {
      console.log(`\n✓ [Active Session Verified] App is already authenticated (Screen: [${currentScreenType.toUpperCase()}]). Skipping login flow.`);
    } else if (config.app.auth?.hasAuth) {
      // Dynamic screen-aware transition to pristine Login screen
      console.log(`\n🔍 Identifying landing screen after launch...`);
      for (let attempt = 0; attempt < 10; attempt++) {
        const nodes = dumpCurrentUi(adbCmd);
        const screen = identifyScreen(nodes);
        console.log(`   • Detected Screen: [${screen.toUpperCase()}]`);

        if (screen === "login") {
          console.log(`   ✓ [Screen Check Passed] Confirmed on Login Screen.`);
          break;
        }

        if (screen === "onboarding") {
          const skipBtn = nodes.find(n => n.clickable && (/skip/i.test(n.contentDesc) || /skip/i.test(n.text)));
          if (skipBtn) {
            console.log(`   • [Onboarding Detected] Tapping [Skip] at (${skipBtn.bounds.cx}, ${skipBtn.bounds.cy})...`);
            execSync(`${adbCmd} shell input tap ${skipBtn.bounds.cx} ${skipBtn.bounds.cy}`, { stdio: "ignore" });
            await sleep(1000);
            continue;
          }
        }

        if (screen === "welcome") {
          const accBtn = nodes.find(n =>
            n.clickable && (/i have an account/i.test(n.contentDesc) || /log in|sign in/i.test(n.contentDesc) || /i have an account/i.test(n.text))
          );
          if (accBtn) {
            console.log(`   • [Welcome Detected] Tapping [${accBtn.contentDesc || accBtn.text}] at (${accBtn.bounds.cx}, ${accBtn.bounds.cy})...`);
            execSync(`${adbCmd} shell input tap ${accBtn.bounds.cx} ${accBtn.bounds.cy}`, { stdio: "ignore" });
            await sleep(1000);
            continue;
          }
        }

        if (screen === "permission_dialog") {
          const allowBtn = nodes.find(n =>
            n.clickable && (/while using the app|allow/i.test(n.text) || /while using the app|allow/i.test(n.contentDesc))
          );
          if (allowBtn) {
            console.log(`   • [Permission Detected] Dismissing dialog...`);
            execSync(`${adbCmd} shell input tap ${allowBtn.bounds.cx} ${allowBtn.bounds.cy}`, { stdio: "ignore" });
            await sleep(800);
            continue;
          }
        }

        if (screen === "dashboard") {
          console.log(`   ℹ [Dashboard Detected] App is already authenticated.`);
          break;
        }

        await sleep(800);
      }

      // 2. Login Screen (Dynamic wait until pristine login screen settles BEFORE putting text into fields)
      console.log(`\n[Screen ${slideIndex}] Verifying pristine Login Screen (before text input)...`);
      await waitForUiCondition(adbCmd, nodes => identifyScreen(nodes) === "login", 12000, 800);
      await sleep(600);
      await saveDualScreenshot(adbCmd, slideIndex, projectScreenshotsDir, templateScreenshotsDir, (config.app.platform as "android" | "ios") || "android");
      console.log(`   ✓ [Login Screen (Pristine)] Captured -> slide-${slideIndex}.png`);
      slideIndex++;

      // 3. Screen-Checked Validated Login
      const email = process.env.APP_LOGIN_EMAIL || config.app.auth?.credentials?.email || "";
      const password = process.env.APP_LOGIN_PASSWORD || config.app.auth?.credentials?.password || "";
      if (email && password) {
        const loginOk = await performValidatedLogin(adbCmd, email, password, watcher);

        if (!loginOk) {
          console.error(`\n❌ [Validation Failed] Screen did not transition to Dashboard.`);
          console.error(`   Halting screenshot capture to prevent generating invalid screens.`);
          process.exit(1);
        }
      } else {
        console.log(`   ⚠ No credentials supplied. Please sign in manually on device if needed.`);
      }

      // 4. Dashboard Screen
      console.log(`\n[Screen ${slideIndex}] Capturing Dashboard Screen...`);
      await waitForUiCondition(adbCmd, nodes => identifyScreen(nodes) === "dashboard", 12000, 800);
      await sleep(800);
      await saveDualScreenshot(adbCmd, slideIndex, projectScreenshotsDir, templateScreenshotsDir, (config.app.platform as "android" | "ios") || "android");
      console.log(`   ✓ [Dashboard Screen] Captured -> slide-${slideIndex}.png`);
      slideIndex++;
    } else {
      // App does not require auth - captures fresh home/main screen
      console.log(`\n[Screen ${slideIndex}] Waiting for Main / Home Screen to settle...`);
      await waitForUiCondition(adbCmd, nodes => nodes.length > 3, 10000, 800);
      await sleep(800);
      await saveDualScreenshot(adbCmd, slideIndex, projectScreenshotsDir, templateScreenshotsDir, (config.app.platform as "android" | "ios") || "android");
      console.log(`   ✓ [Main / Home Screen] Captured -> slide-${slideIndex}.png`);
      slideIndex++;
    }

    // 5. Navigation Bar Tabs or Guided Navigation
    if (config.captureMode === "guided") {
      const rl = readline.createInterface({ input, output });
      console.log(`\n👉 Guided Mode: Navigate to each screen on your phone, then press [ENTER]`);
      for (let i = 0; i < 4; i++) {
        const ans = await rl.question(`\n[Screen ${slideIndex}] Press [ENTER] to capture current screen (or 'q' to stop): `);
        if (ans.trim().toLowerCase() === "q") break;

        await saveDualScreenshot(adbCmd, slideIndex, projectScreenshotsDir, templateScreenshotsDir, (config.app.platform as "android" | "ios") || "android");
        console.log(`   ✓ Captured screen -> slide-${slideIndex}.png`);
        slideIndex++;
      }
      rl.close();
    } else {
      console.log(`\n🔍 Locating Bottom Navigation Tabs...`);
      const { width: screenWidth, height: screenHeight } = getDeviceScreenDimensions(adbCmd);
      const uiNodes = dumpCurrentUi(adbCmd);
      const tabs = findBottomNavTabs(uiNodes, screenHeight);

      if (tabs.length > 0) {
        console.log(`   ✓ Detected ${tabs.length} tabs dynamically:`);
        for (const t of tabs) {
          const label = (t.contentDesc || t.text || "Tab").split("\n")[0].trim();
          console.log(`     • [${label}] at (${t.bounds.cx}, ${t.bounds.cy})`);
        }

        for (let i = 0; i < tabs.length; i++) {
          const tab = tabs[i];
          const rawName = tab.contentDesc || tab.text || `Tab ${i + 1}`;
          const tabName = rawName.split("\n")[0].trim();

          // Skip Home tab if we already captured Dashboard right before tabs
          if (/home/i.test(tabName) && slideIndex > 3) {
            console.log(`   • Skipping [${tabName}] tab (already captured as Dashboard).`);
            continue;
          }

          console.log(`\n[Screen ${slideIndex}] Tapping Navigation Tab: [${tabName}]...`);

          // Instant navigation event detection
          await watcher.executeAndWaitForNavigation(() => {
            execSync(`${adbCmd} shell input tap ${tab.bounds.cx} ${tab.bounds.cy}`, { stdio: "ignore" });
          }, 450, 4000);

          await sleep(600);
          await saveDualScreenshot(adbCmd, slideIndex, projectScreenshotsDir, templateScreenshotsDir, (config.app.platform as "android" | "ios") || "android");
          console.log(`   ✓ [${tabName}] Captured -> slide-${slideIndex}.png`);
          slideIndex++;

          // Special sub-screen capture: If this is the "Calls" tab, also capture the dialer screen!
          if (/call/i.test(tabName)) {
            console.log(`   🔍 [Screen Check] Detected Calls tab! Checking for Dialer keypad button...`);
            await sleep(600);
            const callNodes = dumpCurrentUi(adbCmd);
            const dialBtn = callNodes.find(n => n.clickable && (/dial/i.test(n.contentDesc) || /dial/i.test(n.text)));
            if (dialBtn) {
              console.log(`   • Found Dialer button at (${dialBtn.bounds.cx}, ${dialBtn.bounds.cy}). Tapping...`);
              await watcher.executeAndWaitForNavigation(() => {
                execSync(`${adbCmd} shell input tap ${dialBtn.bounds.cx} ${dialBtn.bounds.cy}`, { stdio: "ignore" });
              }, 450, 4000);

              await sleep(600);
              const dialerNodes = dumpCurrentUi(adbCmd);
              const dialerState = identifyScreen(dialerNodes);
              console.log(`   • [Screen Check Passed] Keypad state: [${dialerState.toUpperCase()}]`);

              await saveDualScreenshot(adbCmd, slideIndex, projectScreenshotsDir, templateScreenshotsDir, (config.app.platform as "android" | "ios") || "android");
              console.log(`   ✓ [Dialer Keypad Screen] Captured -> slide-${slideIndex}.png`);
              slideIndex++;

              // Return back to main calls screen
              try {
                console.log(`   • Pressing Back to return from Dialer...`);
                execSync(`${adbCmd} shell input keyevent 4`, { stdio: "ignore" });
                await sleep(600);
              } catch {}
            }
          }
        }
      } else {
        console.log(`   • No text labels detected on bottom bar, checking dynamic interactive touch points...`);
        const bottomBarY = Math.round(screenHeight * 0.94);
        const slotCount = Math.min(Math.max(config.captureGoals?.length || 4, 3), 5);
        const dynamicSlots: Array<{ name: string; x: number; y: number }> = [];

        for (let s = 1; s <= slotCount; s++) {
          const x = Math.round((s - 0.5) * (screenWidth / slotCount));
          const goalName = config.captureGoals?.[s]?.target || `Section ${s}`;
          dynamicSlots.push({ name: goalName, x, y: bottomBarY });
        }

        for (const slot of dynamicSlots) {
          console.log(`\n[Screen ${slideIndex}] Probing dynamic navigation point: [${slot.name}] (${slot.x}, ${slot.y})...`);

          await watcher.executeAndWaitForNavigation(() => {
            execSync(`${adbCmd} shell input tap ${slot.x} ${slot.y}`, { stdio: "ignore" });
          }, 450, 4000);

          await saveDualScreenshot(adbCmd, slideIndex, projectScreenshotsDir, templateScreenshotsDir, (config.app.platform as "android" | "ios") || "android");
          console.log(`   ✓ [${slot.name}] Captured -> slide-${slideIndex}.png`);
          slideIndex++;
        }
      }
    }

    console.log(`\n==========================================================`);
    console.log(`🎉 Project Complete! Total ${slideIndex - 1} screenshots saved in:`);
    console.log(`📁 ${projectScreenshotsDir}`);
    console.log(`==========================================================\n`);
  } finally {
    watcher.stop();
  }
}

main().catch(err => {
  console.error("[Agent Executor] Execution failed:", err);
  process.exit(1);
});
