// scripts/ui-inspector.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface UiElement {
  text: string;
  resourceId: string;
  className: string;
  contentDesc: string;
  hint: string;
  clickable: boolean;
  password: boolean;
  bounds: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    cx: number;
    cy: number;
  };
}

export function parseHierarchy(xmlContent: string): UiElement[] {
  const elements: UiElement[] = [];
  const nodeRegex = /<node\s+([^>]+)>/g;
  let match: RegExpExecArray | null;

  while ((match = nodeRegex.exec(xmlContent)) !== null) {
    const rawAttrs = match[1];

    const getAttr = (name: string): string => {
      const attrMatch = rawAttrs.match(new RegExp(`${name}="([^"]*)"`));
      return attrMatch ? attrMatch[1] : "";
    };

    const boundsStr = getAttr("bounds");
    const boundsMatch = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!boundsMatch) continue;

    const x1 = parseInt(boundsMatch[1], 10);
    const y1 = parseInt(boundsMatch[2], 10);
    const x2 = parseInt(boundsMatch[3], 10);
    const y2 = parseInt(boundsMatch[4], 10);

    elements.push({
      text: getAttr("text"),
      resourceId: getAttr("resource-id"),
      className: getAttr("class"),
      contentDesc: getAttr("content-desc"),
      hint: getAttr("hint"),
      clickable: getAttr("clickable") === "true",
      password: getAttr("password") === "true",
      bounds: {
        x1,
        y1,
        x2,
        y2,
        cx: Math.round((x1 + x2) / 2),
        cy: Math.round((y1 + y2) / 2)
      }
    });
  }

  return elements;
}

export function dumpCurrentUi(adbCmd: string): UiElement[] {
  try {
    execSync(`${adbCmd} shell uiautomator dump /sdcard/dyn_dump.xml`, { stdio: "ignore" });
    const tempFile = path.resolve(process.cwd(), "dyn_dump_temp.xml");
    execSync(`${adbCmd} pull /sdcard/dyn_dump.xml "${tempFile}"`, { stdio: "ignore" });
    if (fs.existsSync(tempFile)) {
      const xml = fs.readFileSync(tempFile, "utf-8");
      try { fs.unlinkSync(tempFile); } catch {}
      return parseHierarchy(xml);
    }
  } catch {}
  return [];
}

/**
 * Checks if Android soft keyboard (IME) is actively displayed.
 */
export function isKeyboardShown(adbCmd: string): boolean {
  try {
    const out = execSync(`${adbCmd} shell dumpsys input_method`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    });
    return out.includes("mInputShown=true");
  } catch {
    return false;
  }
}

/**
 * Dismisses soft keyboard reliably using KEYCODE_BACK and verifies closure.
 */
export function minimizeKeyboard(adbCmd: string): void {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!isKeyboardShown(adbCmd)) break;
    try {
      execSync(`${adbCmd} shell input keyevent 4`, { stdio: "ignore" }); // KEYCODE_BACK dismisses IME
    } catch {}
    const start = Date.now();
    while (Date.now() - start < 350) {}
  }

  // If still shown or view has not un-scrolled, tap neutral upper banner and escape
  if (isKeyboardShown(adbCmd)) {
    try {
      execSync(`${adbCmd} shell input tap 540 250`, { stdio: "ignore" });
      execSync(`${adbCmd} shell input keyevent 111`, { stdio: "ignore" }); // KEYCODE_ESCAPE
    } catch {}
  }
}

/**
 * Focuses input field, clears existing characters, and types escaped text.
 */
export function clearAndInputText(adbCmd: string, cx: number, cy: number, value: string): void {
  // 1. Focus input
  execSync(`${adbCmd} shell input tap ${cx} ${cy}`, { stdio: "ignore" });
  const start = Date.now();
  while (Date.now() - start < 350) {}

  // 2. Clear existing text
  execSync(`${adbCmd} shell input keyevent 123`, { stdio: "ignore" }); // KEYCODE_MOVE_END
  for (let i = 0; i < 30; i++) {
    execSync(`${adbCmd} shell input keyevent 67`, { stdio: "ignore" }); // KEYCODE_DEL
  }

  // 3. Escape for Android shell input text
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/ /g, "%s")
    .replace(/&/g, "\\&")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/;/g, "\\;")
    .replace(/\|/g, "\\|");

  execSync(`${adbCmd} shell input text "${escaped}"`, { stdio: "ignore" });
}

/**
 * Strictly finds the actual EditText input field for email/username.
 * Ignores static android.view.View labels.
 */
export function findInputForEmail(elements: UiElement[]): UiElement | undefined {
  const editTexts = elements.filter(el => el.className.includes("EditText"));

  // 1. Look for EditText with email/user hint or contentDesc
  const byHint = editTexts.find(el =>
    !el.password &&
    (/email|username|phone|user|name@|example/i.test(el.hint) || /email|username|phone|user/i.test(el.contentDesc))
  );
  if (byHint) return byHint;

  // 2. Fall back to the first non-password EditText
  return editTexts.find(el => !el.password);
}

/**
 * Strictly finds the actual EditText input field for password.
 */
export function findInputForPassword(elements: UiElement[]): UiElement | undefined {
  const editTexts = elements.filter(el => el.className.includes("EditText"));

  // 1. Look for password=true EditText
  const byPass = editTexts.find(el => el.password);
  if (byPass) return byPass;

  // 2. Look for password hint
  return editTexts.find(el => /password|pass|pin/i.test(el.hint) || /password|pass|pin/i.test(el.contentDesc));
}

export function findButtonByKeywords(elements: UiElement[], keywords: RegExp): UiElement | undefined {
  return elements.find(el =>
    (el.clickable || el.className.includes("Button")) &&
    (keywords.test(el.contentDesc) || keywords.test(el.text) || keywords.test(el.resourceId))
  );
}

/**
 * Searches UI elements for a clickable button, tab, card, or menu item
 * that matches a target screen name (e.g. "Profile", "Orders", "Settings").
 */
export function findElementForGoal(elements: UiElement[], targetName: string): UiElement | undefined {
  if (!targetName) return undefined;
  const cleanTarget = targetName.replace(/screen|view|page|tab/gi, "").trim();
  if (!cleanTarget) return undefined;

  const wordRegex = new RegExp(`\\b${cleanTarget}\\b`, "i");
  const subRegex = new RegExp(cleanTarget, "i");

  // 1. Clickable element matching exact word boundary in text or contentDesc
  const match = elements.find(el =>
    el.clickable &&
    (wordRegex.test(el.text) || wordRegex.test(el.contentDesc))
  );
  if (match) return match;

  // 2. Clickable element with substring match in text, contentDesc, or resourceId
  const subMatch = elements.find(el =>
    el.clickable &&
    (subRegex.test(el.text) || subRegex.test(el.contentDesc) || subRegex.test(el.resourceId))
  );
  if (subMatch) return subMatch;

  // 3. Text element whose parent container might be clickable (ignore system bar y < 150)
  const textMatch = elements.find(el =>
    (wordRegex.test(el.text) || subRegex.test(el.text)) &&
    el.bounds.cy > 150
  );
  return textMatch;
}

export function getDeviceScreenDimensions(adbCmd: string): { width: number; height: number } {
  try {
    const out = execSync(`${adbCmd} shell wm size`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
    const match = out.match(/Physical size:\s*(\d+)x(\d+)/i) || out.match(/(\d+)x(\d+)/);
    if (match) {
      return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
    }
  } catch {}
  return { width: 1080, height: 2340 };
}

export function findBottomNavTabs(elements: UiElement[], screenHeight?: number): UiElement[] {
  const maxH = screenHeight || Math.max(...elements.map(e => e.bounds.y2), 2340);
  const thresholdY = maxH * 0.82;
  const bottomClickables = elements.filter(el =>
    el.clickable &&
    el.bounds.y1 >= thresholdY &&
    el.bounds.y2 <= maxH + 50 &&
    (el.bounds.y2 - el.bounds.y1) < (maxH * 0.20) &&
    // Strictly exclude landing action buttons and walkthrough buttons
    !/continue as guest|create account|i have an account|sign in|log in|google|email|submit|skip|next/i.test(el.contentDesc) &&
    !/continue as guest|create account|i have an account|sign in|log in|google|email|submit|skip|next/i.test(el.text)
  );

  const sorted = bottomClickables.sort((a, b) => a.bounds.x1 - b.bounds.x1);
  const uniqueTabs: UiElement[] = [];

  for (const item of sorted) {
    const isNearby = uniqueTabs.some(t => Math.abs(t.bounds.cx - item.bounds.cx) < 70);
    if (!isNearby) {
      uniqueTabs.push(item);
    }
  }

  return uniqueTabs;
}

export function hasValidationErrors(elements: UiElement[]): string[] {
  const errorPatterns = [
    /email is required/i,
    /min \d+ characters/i,
    /password is required/i,
    /invalid credentials/i,
    /incorrect password/i,
    /user not found/i,
    /field is required/i,
    /authentication failed/i
  ];

  const found: string[] = [];
  for (const el of elements) {
    const textToCheck = `${el.contentDesc} ${el.text}`.trim();
    for (const pat of errorPatterns) {
      if (pat.test(textToCheck)) {
        found.push(textToCheck);
      }
    }
  }
  return found;
}

export type DetectedScreenType =
  | "permission_dialog"
  | "onboarding"
  | "welcome"
  | "login"
  | "dashboard"
  | "dialer"
  | "unknown";

/**
 * Intelligently classifies the current mobile screen based on its accessibility hierarchy.
 */
export function identifyScreen(elements: UiElement[], screenHeight?: number): DetectedScreenType {
  // 1. Permission dialog check
  const hasPermission = elements.some(n =>
    /while using the app|only this time|don't allow|allow/i.test(n.text) ||
    /while using the app|only this time|don't allow|allow/i.test(n.contentDesc)
  );
  if (hasPermission && elements.length < 15) {
    return "permission_dialog";
  }

  // 2. Onboarding walkthrough check (walkthrough carousel with Skip / Next)
  const hasSkipOrNext = elements.some(n =>
    n.clickable && (/^skip$/i.test(n.contentDesc) || /^skip$/i.test(n.text) || /^next$/i.test(n.contentDesc) || /^next$/i.test(n.text))
  );
  const hasOnboardingContent = elements.some(n => /simless numbers|countries|walkthrough|get started/i.test(n.contentDesc));
  if (hasSkipOrNext && (hasOnboardingContent || elements.length < 20)) {
    return "onboarding";
  }

  // 3. Welcome landing screen check (before login screen)
  const hasIHaveAccount = elements.some(n =>
    n.clickable && (/i have an account|create account|continue as guest/i.test(n.contentDesc) ||
                    /i have an account|create account|continue as guest/i.test(n.text))
  );
  const hasWelcomeText = elements.some(n => /\bwelcome\b/i.test(n.contentDesc) || /\bwelcome\b/i.test(n.text));
  if (hasIHaveAccount || hasWelcomeText) {
    return "welcome";
  }

  // 4. Login screen check:
  const emailInput = findInputForEmail(elements);
  const passInput = findInputForPassword(elements);
  const hasSignInBtn = elements.some(n =>
    n.clickable && (/^sign in$/i.test(n.contentDesc) || /^log in$/i.test(n.contentDesc) || /^login$/i.test(n.contentDesc) ||
                    /^sign in$/i.test(n.text) || /^log in$/i.test(n.text) || /^login$/i.test(n.text))
  );
  const isWelcomeBack = elements.some(n => /welcome back/i.test(n.contentDesc) || /welcome back/i.test(n.text));

  if ((emailInput && passInput) || (emailInput && hasSignInBtn) || (isWelcomeBack && emailInput)) {
    return "login";
  }

  // 5. Dialer keypad check (contains 0-9 digits arranged as keypad buttons)
  const keypadDigits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].filter(digit =>
    elements.some(n => (n.contentDesc || n.text || "").startsWith(digit))
  );
  if (keypadDigits.length >= 6) {
    return "dialer";
  }

  // 6. Bottom navigation tabs check -> Dashboard / Main section
  const tabs = findBottomNavTabs(elements, screenHeight);
  if (tabs.length >= 2) {
    return "dashboard";
  }

  return "unknown";
}

/**
 * Checks if the current UI is displaying the login page.
 */
export function isLoginScreen(elements: UiElement[]): boolean {
  const tabs = findBottomNavTabs(elements);
  if (tabs.length >= 2) return false;
  return identifyScreen(elements) === "login";
}

/**
 * Checks if the login screen is actively loaded with input fields or login controls.
 */
export function isLoginScreenReady(elements: UiElement[]): boolean {
  return identifyScreen(elements) === "login";
}

/**
 * Actively polls the device UI hierarchy until the given predicate returns true,
 * or the maximum wait timeout is reached.
 */
export async function waitForUiCondition(
  adbCmd: string,
  predicate: (nodes: UiElement[]) => boolean,
  timeoutMs = 15000,
  intervalMs = 800
): Promise<{ success: boolean; nodes: UiElement[] }> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const nodes = dumpCurrentUi(adbCmd);
    if (predicate(nodes)) {
      return { success: true, nodes };
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { success: false, nodes: dumpCurrentUi(adbCmd) };
}
