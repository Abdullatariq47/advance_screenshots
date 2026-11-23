// scripts/agent-executor.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { processScreenshotCrossPlatform } from "./system-bar-cropper.js";
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
  waitForUiCondition,
} from "./ui-inspector.js";
import { AdbNavigationWatcher } from "./adb-navigation-watcher.js";
import { detectActivePackage } from "./interactive-prompt.js";
import {
  detectAllConnectedDevices,
  captureDeviceScreenshot,
  ConnectedDevice,
  getAdbPath
} from "./device-detector.js";

function parseArgs(): { configPath: string; projectDir?: string; coldRestart: boolean; platform?: "ios" | "android" } {
  const args = process.argv.slice(2);
  let configPath = path.resolve(process.cwd(), "pipeline.config.json");
  let projectDir: string | undefined;
  let platform: "ios" | "android" | undefined;
  const coldRestart = args.includes("--cold-restart") || args.includes("--restart");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      configPath = path.resolve(process.cwd(), args[i + 1]);
    }
    if (args[i] === "--projectDir" && args[i + 1]) {
      projectDir = path.resolve(process.cwd(), args[i + 1]);
    }
    if (args[i] === "--platform" && args[i + 1]) {
      const p = args[i + 1].trim().toLowerCase();
      if (p === "ios" || p === "android") platform = p;
    }
  }
  return { configPath, projectDir, coldRestart, platform };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function saveDualScreenshot(
  targetDevice: ConnectedDevice,
  slideIndex: number,
  projectScreenshotsDir: string,
  templateScreenshotsDir: string
): Promise<boolean> {
  const fileName = `slide-${slideIndex}.png`;
  const projectDest = path.join(projectScreenshotsDir, fileName);
  const templateDest = path.join(templateScreenshotsDir, fileName);

  try {
    const snapOk = await captureDeviceScreenshot(targetDevice, projectDest);
    if (snapOk && fs.existsSync(projectDest) && fs.statSync(projectDest).size > 1000) {
      fs.copyFileSync(projectDest, templateDest);

      // Auto-generate store-sanitized iOS and Android variants
      const projectIosDest = path.join(projectScreenshotsDir, `slide-${slideIndex}-ios.png`);
      const projectAndroidDest = path.join(projectScreenshotsDir, `slide-${slideIndex}-android.png`);
      const templateIosDest = path.join(templateScreenshotsDir, `slide-${slideIndex}-ios.png`);
      const templateAndroidDest = path.join(templateScreenshotsDir, `slide-${slideIndex}-android.png`);

      await processScreenshotCrossPlatform(
        projectDest,
        projectIosDest,
        projectAndroidDest,
        targetDevice.platform,
        targetDevice.platform === "android" ? "current_screen.xml" : undefined
      );

      if (fs.existsSync(projectIosDest)) fs.copyFileSync(projectIosDest, templateIosDest);
      if (fs.existsSync(projectAndroidDest)) fs.copyFileSync(projectAndroidDest, templateAndroidDest);

      return true;
    }
  } catch (err) {
    console.warn("   ⚠ Cross-platform cropping notice:", err);
  }
  return false;
}

async function promptUserForInteraction(reason: string, screenState: string): Promise<boolean> {
  console.log(`\n==========================================================`);
  console.log(`🔔 [Action Required] ${reason}`);
  console.log(`   Screen State: [${screenState.toUpperCase()}]`);
  console.log(`   👉 Please complete this step on your device screen.`);
  console.log(`==========================================================`);
  const rl = readline.createInterface({ input, output });
  const ans = await rl.question(`Press [ENTER] once you have reached the main app screen (or 'q' to quit): `);
  rl.close();

  return ans.trim().toLowerCase() !== "q";
}

async function performValidatedLogin(
  adbCmd: string,
  email: string,
  pass: string,
  watcher: AdbNavigationWatcher
): Promise<boolean> {
  console.log(`\n🔐 Performing Screen-Aware Auto-Login for [${email}]...`);

  let currentNodes = dumpCurrentUi(adbCmd);
  let currentScreen = identifyScreen(currentNodes);
  console.log(`   • Current detected screen state: [${currentScreen.toUpperCase()}]`);

  if (currentScreen === "dashboard") {
    console.log(`   ✓ [Screen Check] App is already authenticated and on Dashboard.`);
    return true;
  }

  if (currentScreen !== "login") {
    console.log(`   • Waiting for Login screen to be confirmed...`);
    const ready = await waitForUiCondition(
      adbCmd,
      nodes => identifyScreen(nodes) === "login",
      10000,
      600
    );

    if (!ready.success) {
      console.warn(`   ⚠ Login screen not confirmed. Asking user for interaction...`);
      return promptUserForInteraction("User Authentication Needed", identifyScreen(dumpCurrentUi(adbCmd)));
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
      console.warn(`   ⚠ Could not automatically identify EditText fields.`);
      break;
    }

    console.log(`   • Found Email field at (${emailNode.bounds.cx}, ${emailNode.bounds.cy}). Typing...`);
    clearAndInputText(adbCmd, emailNode.bounds.cx, emailNode.bounds.cy, email);
    await sleep(350);
    minimizeKeyboard(adbCmd);
    await sleep(400);

    nodes = dumpCurrentUi(adbCmd);
    const passNodeFresh = findInputForPassword(nodes) || passNode;
    console.log(`   • Found Password field at (${passNodeFresh.bounds.cx}, ${passNodeFresh.bounds.cy}). Typing...`);
    clearAndInputText(adbCmd, passNodeFresh.bounds.cx, passNodeFresh.bounds.cy, pass);
    await sleep(350);
    minimizeKeyboard(adbCmd);
    await sleep(500);

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
      await sleep(500);
    }
  }

  // If automated typing did not work cleanly, hand off gracefully to user
  if (!isFilled) {
    return promptUserForInteraction("Credentials Entry Needed", "LOGIN");
  }

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
    await watcher.executeAndWaitForNavigation(() => {
      execSync(`${adbCmd} shell input tap ${Math.round(sw / 2)} ${fallbackY}`, { stdio: "ignore" });
    }, 500, 7000);
  }

  // Validate screen transition
  console.log(`   • Validating screen transition...`);
  let loginSuccess = false;

  for (let wait = 0; wait < 8; wait++) {
    await sleep(1000);
    nodes = dumpCurrentUi(adbCmd);

    const skipBtn = findButtonByKeywords(nodes, /skip to dashboard|skip|continue|check in|allow|ok|dismiss/i);
    if (skipBtn) {
      console.log(`   • Tapping intermediate prompt [${skipBtn.contentDesc || skipBtn.text}]...`);
      await watcher.executeAndWaitForNavigation(() => {
        execSync(`${adbCmd} shell input tap ${skipBtn.bounds.cx} ${skipBtn.bounds.cy}`, { stdio: "ignore" });
      }, 500, 4000);
      await sleep(1000);
      loginSuccess = true;
      break;
    }

    if (!isLoginScreen(nodes)) {
      loginSuccess = true;
      console.log(`   ✓ [Screen Transition Verified] Successfully transitioned past Login screen!`);
      break;
    }
  }

  if (!loginSuccess) {
    return promptUserForInteraction("Login / 2FA / OTP Verification Needed", identifyScreen(dumpCurrentUi(adbCmd)));
  }

  return loginSuccess;
}

/**
 * Handles Autonomous Navigation on iOS Devices / Simulators.
 */
async function runIosAutonomousWorkflow(
  device: ConnectedDevice,
  config: any,
  projectScreenshotsDir: string,
  templateScreenshotsDir: string
) {
  console.log(`\n==========================================================`);
  console.log(`Running iOS Autonomous Pipeline on: ${device.name}`);
  console.log(`App Bundle ID: ${config.app.appId}`);
  console.log(`==========================================================\n`);

  let slideIndex = 1;

  // 1. Launch App
  if (device.type === "simulator") {
    console.log(`[Screen ${slideIndex}] Launching ${config.app.appId} on iOS Simulator...`);
    try {
      execSync(`xcrun simctl launch ${device.id || "booted"} ${config.app.appId}`, { stdio: "ignore" });
      await sleep(2500);
    } catch {
      console.log(`   ℹ Simulator launch notice: please ensure app is installed on simulator.`);
    }
  } else {
    console.log(`[Screen ${slideIndex}] Please open "${config.app.appId}" on your iPhone screen.`);
    const rl = readline.createInterface({ input, output });
    await rl.question(`Press [ENTER] once "${config.app.appId}" is open and visible on your iPhone... `);
    rl.close();
    await sleep(600);
  }

  // Capture Landing / Splash Screen
  await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
  console.log(`   ✓ [Initial Screen] Captured -> slide-${slideIndex}.png`);
  slideIndex++;

  // 2. Auth / Onboarding Check
  if (config.app.auth?.hasAuth) {
    const proceed = await promptUserForInteraction("Authentication / Sign-In Check", "LOGIN / ONBOARDING");
    if (!proceed) {
      console.log("Autonomous workflow stopped by user.");
      return;
    }
    await sleep(1000);
    await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
    console.log(`   ✓ [Dashboard Screen] Captured -> slide-${slideIndex}.png`);
    slideIndex++;
  }

  // 3. Navigate through remaining screens with smart guidance
  const rl = readline.createInterface({ input, output });
  const maxScreens = Math.min(Math.max(config.captureGoals?.length || 4, 3), 6);

  console.log(`\n👉 Autonomous Explorer: Capture up to ${maxScreens} key screens of your app.`);
  while (slideIndex <= maxScreens) {
    const goal = config.captureGoals?.[slideIndex - 1]?.target || `Screen ${slideIndex}`;
    const ans = await rl.question(`\n[Screen ${slideIndex}] Navigate on your iPhone to [${goal}] and press [ENTER] (or 'done' to finish): `);
    const trimmed = ans.trim().toLowerCase();

    if (trimmed === "done" || trimmed === "d" || trimmed === "q") {
      break;
    }

    await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
    console.log(`   ✓ [${goal}] Captured -> slide-${slideIndex}.png`);
    slideIndex++;
  }
  rl.close();

  console.log(`\n==========================================================`);
  console.log(`🎉 iOS Capture Complete! Total ${slideIndex - 1} screenshots saved in:`);
  console.log(`📁 ${projectScreenshotsDir}`);
  console.log(`==========================================================\n`);
}

/**
 * Handles Autonomous Navigation on Android Devices / Emulators.
 */
async function runAndroidAutonomousWorkflow(
  device: ConnectedDevice,
  config: any,
  projectScreenshotsDir: string,
  templateScreenshotsDir: string,
  coldRestart: boolean
) {
  const adbCmd = device.adbCmd || getAdbPath();
  const watcher = new AdbNavigationWatcher(adbCmd);
  watcher.start();
  console.log(`⚡ [Real-Time Engine] ADB event stream active (Zero-latency navigation detection).`);

  try {
    let slideIndex = 1;
    const activePackage = detectActivePackage(adbCmd);
    const isAlreadyRunning = Boolean(activePackage && activePackage === config.app.appId);

    if (isAlreadyRunning && !coldRestart) {
      console.log(`[Live App Detected] "${config.app.appId}" is already open on screen.`);
      console.log(`   ⚡ In-Flight Attach: Preserving your active screen, login session & data.`);

      await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
      console.log(`   ✓ [Active Screen] Captured -> slide-${slideIndex}.png`);
      slideIndex++;
    } else {
      if (config.app.auth?.hasAuth && coldRestart) {
        console.log(`🧹 Clearing app data to ensure pristine onboarding & login capture...`);
        try { execSync(`${adbCmd} -s ${device.id} shell pm clear ${config.app.appId}`, { stdio: "ignore" }); } catch {}
      }

      console.log(`[Screen ${slideIndex}] Launching app for Splash Screen capture...`);
      try { execSync(`${adbCmd} -s ${device.id} shell am force-stop ${config.app.appId}`, { stdio: "ignore" }); } catch {}

      await watcher.executeAndWaitForNavigation(() => {
        execSync(`${adbCmd} -s ${device.id} shell monkey -p ${config.app.appId} -c android.intent.category.LAUNCHER 1`, { stdio: "ignore" });
      }, 600, 10000);

      await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
      console.log(`   ✓ [Splash Screen] Captured -> slide-${slideIndex}.png`);
      slideIndex++;
    }

    // Inspect landing screen state
    const currentNodes = dumpCurrentUi(adbCmd);
    const currentScreenType = identifyScreen(currentNodes);
    const needsAuthCheck = isLoginScreen(currentNodes) || currentScreenType === "login" || currentScreenType === "welcome" || currentScreenType === "onboarding";

    if (needsAuthCheck) {
      console.log(`\n🔍 Landing Screen requires user interaction: [${currentScreenType.toUpperCase()}]`);

      // Attempt automated skip of onboarding if skip button exists
      if (currentScreenType === "onboarding") {
        const skipBtn = currentNodes.find(n => n.clickable && (/skip/i.test(n.contentDesc) || /skip/i.test(n.text)));
        if (skipBtn) {
          console.log(`   • [Onboarding Detected] Tapping [Skip]...`);
          execSync(`${adbCmd} -s ${device.id} shell input tap ${skipBtn.bounds.cx} ${skipBtn.bounds.cy}`, { stdio: "ignore" });
          await sleep(1000);
        }
      }

      const email = process.env.APP_LOGIN_EMAIL || config.app.auth?.credentials?.email || "";
      const password = process.env.APP_LOGIN_PASSWORD || config.app.auth?.credentials?.password || "";

      if (email && password) {
        // Pristine capture before filling
        await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
        console.log(`   ✓ [Login Screen (Pristine)] Captured -> slide-${slideIndex}.png`);
        slideIndex++;

        const loginOk = await performValidatedLogin(adbCmd, email, password, watcher);
        if (!loginOk) {
          await promptUserForInteraction("User Login Required", "LOGIN");
        }
      } else {
        // No credentials in config -> ask user to interact directly on phone!
        await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
        console.log(`   ✓ [Login / Welcome Screen] Captured -> slide-${slideIndex}.png`);
        slideIndex++;

        await promptUserForInteraction("Sign-In / Form Interaction Needed", currentScreenType);
      }

      // Capture Authenticated Dashboard
      await sleep(1000);
      await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
      console.log(`   ✓ [Dashboard Screen] Captured -> slide-${slideIndex}.png`);
      slideIndex++;
    } else {
      console.log(`\n✓ [Main Screen Verified] App landed directly on authenticated screen: [${currentScreenType.toUpperCase()}].`);
      await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
      console.log(`   ✓ [Main / Home Screen] Captured -> slide-${slideIndex}.png`);
      slideIndex++;
    }

    // 4. Explore Remaining Tabs & Screens
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

        if (/home/i.test(tabName) && slideIndex > 3) {
          continue;
        }

        console.log(`\n[Screen ${slideIndex}] Tapping Navigation Tab: [${tabName}]...`);

        await watcher.executeAndWaitForNavigation(() => {
          execSync(`${adbCmd} -s ${device.id} shell input tap ${tab.bounds.cx} ${tab.bounds.cy}`, { stdio: "ignore" });
        }, 450, 4000);

        await sleep(600);
        await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
        console.log(`   ✓ [${tabName}] Captured -> slide-${slideIndex}.png`);
        slideIndex++;

        // Sub-screen handling for calls/dialer
        if (/call/i.test(tabName)) {
          const callNodes = dumpCurrentUi(adbCmd);
          const dialBtn = callNodes.find(n => n.clickable && (/dial/i.test(n.contentDesc) || /dial/i.test(n.text)));
          if (dialBtn) {
            console.log(`   • Found Dialer keypad button. Tapping...`);
            await watcher.executeAndWaitForNavigation(() => {
              execSync(`${adbCmd} -s ${device.id} shell input tap ${dialBtn.bounds.cx} ${dialBtn.bounds.cy}`, { stdio: "ignore" });
            }, 450, 4000);

            await sleep(600);
            await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
            console.log(`   ✓ [Dialer Keypad Screen] Captured -> slide-${slideIndex}.png`);
            slideIndex++;

            try {
              execSync(`${adbCmd} -s ${device.id} shell input keyevent 4`, { stdio: "ignore" });
              await sleep(600);
            } catch {}
          }
        }
      }
    } else {
      // No bottom tabs: look for clickable content cards or ask user
      console.log(`   • No bottom tabs found. Inspecting clickable cards and content list...`);
      const clickableCards = uiNodes.filter(n =>
        n.clickable &&
        n.bounds.cy > screenHeight * 0.2 &&
        n.bounds.cy < screenHeight * 0.8 &&
        (n.bounds.x2 - n.bounds.x1) > screenWidth * 0.4
      );

      if (clickableCards.length > 0) {
        const targetCard = clickableCards[0];
        console.log(`   • Navigating into detail card at (${targetCard.bounds.cx}, ${targetCard.bounds.cy})...`);

        await watcher.executeAndWaitForNavigation(() => {
          execSync(`${adbCmd} -s ${device.id} shell input tap ${targetCard.bounds.cx} ${targetCard.bounds.cy}`, { stdio: "ignore" });
        }, 450, 4000);

        await sleep(800);
        await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
        console.log(`   ✓ [Detail View] Captured -> slide-${slideIndex}.png`);
        slideIndex++;

        // Return back
        try {
          execSync(`${adbCmd} -s ${device.id} shell input keyevent 4`, { stdio: "ignore" });
          await sleep(600);
        } catch {}
      }

      // If user is interactive and more screens can be captured, ask user
      if (process.stdin.isTTY && slideIndex < 5) {
        const rl = readline.createInterface({ input, output });
        const ans = await rl.question(`\n[Screen ${slideIndex}] Navigate on your phone to any other screen to capture, then press [ENTER] (or 'done' to finish): `);
        rl.close();
        if (ans.trim().toLowerCase() !== "done" && ans.trim().toLowerCase() !== "d") {
          await saveDualScreenshot(device, slideIndex, projectScreenshotsDir, templateScreenshotsDir);
          console.log(`   ✓ Captured screen -> slide-${slideIndex}.png`);
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

async function main() {
  const { configPath, projectDir: argProjectDir, coldRestart, platform: argPlatform } = parseArgs();
  if (!fs.existsSync(configPath)) {
    console.error(`[Agent Executor] Configuration file not found at ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const requestedPlatform: "ios" | "android" = argPlatform || config?.app?.platform || (process.platform === "darwin" ? "ios" : "android");

  const connectedDevices = detectAllConnectedDevices();
  let targetDevice: ConnectedDevice | null = connectedDevices.find(d => d.platform === requestedPlatform) || connectedDevices[0] || null;

  if (!targetDevice) {
    console.error(`\n❌ [No Device Connected] No active ${requestedPlatform === "ios" ? "iPhone or iOS Simulator" : "Android phone or emulator"} found.`);
    if (requestedPlatform === "ios") {
      console.error("   👉 Please start an iOS Simulator (e.g. 'open -a Simulator') or connect an iPhone via USB.");
    } else {
      console.error("   👉 Please connect an Android phone with USB debugging or start an Android emulator.");
    }
    process.exit(1);
  }

  const resolvedProjectDir = argProjectDir || path.resolve(process.cwd(), "projects", config.app.appId);
  const projectScreenshotsDir = path.join(resolvedProjectDir, "screenshots");
  const templateScreenshotsDir = path.resolve(process.cwd(), "template/public/screenshots");

  if (!fs.existsSync(projectScreenshotsDir)) fs.mkdirSync(projectScreenshotsDir, { recursive: true });
  if (!fs.existsSync(templateScreenshotsDir)) fs.mkdirSync(templateScreenshotsDir, { recursive: true });

  if (targetDevice.platform === "ios") {
    await runIosAutonomousWorkflow(targetDevice, config, projectScreenshotsDir, templateScreenshotsDir);
  } else {
    await runAndroidAutonomousWorkflow(targetDevice, config, projectScreenshotsDir, templateScreenshotsDir, coldRestart);
  }
}

main().catch(err => {
  console.error("[Agent Executor] Execution failed:", err);
  process.exit(1);
});
