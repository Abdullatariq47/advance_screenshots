// scripts/vision-copywriter.ts
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { SlideConfig } from "./generate-project-state.js";

interface ScreenVisionResult {
  topLabel: string;
  headline: string;
  subtext: string;
  layoutVariant: SlideConfig["layoutVariant"];
  callout?: {
    title: string;
    description: string;
    focusX: number;
    focusY: number;
    zoom: number;
  };
}

function loadDotEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env");
  const envVars: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const k = trimmed.substring(0, eqIdx).trim();
        const v = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        envVars[k] = v;
      }
    }
  }
  return envVars;
}

/**
 * Call Anthropic Claude Vision (Claude 3.5 Sonnet) using native fetch
 */
async function callClaudeVision(
  apiKey: string,
  base64Data: string,
  prompt: string
): Promise<ScreenVisionResult | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 600,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64Data
                }
              },
              {
                type: "text",
                text: prompt
              }
            ]
          }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Vision AI] Claude Vision API returned ${res.status}:`, errText);
      return null;
    }

    const data: any = await res.json();
    const contentText = data.content?.[0]?.text;
    if (contentText) {
      const cleanJson = contentText.replace(/```json|```/gi, "").trim();
      const parsed = JSON.parse(cleanJson);
      if (parsed.topLabel && parsed.headline && parsed.subtext) {
        return parsed as ScreenVisionResult;
      }
    }
  } catch (err: any) {
    console.warn(`[Vision AI] Claude Vision call error:`, err?.message || err);
  }
  return null;
}

/**
 * Call OpenAI Vision (GPT-4o / GPT-4o-mini) using native fetch
 */
async function callOpenAIVision(
  apiKey: string,
  base64Data: string,
  prompt: string
): Promise<ScreenVisionResult | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Data}`,
                  detail: "high"
                }
              }
            ]
          }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Vision AI] OpenAI Vision API returned ${res.status}:`, errText);
      return null;
    }

    const data: any = await res.json();
    const contentText = data.choices?.[0]?.message?.content;
    if (contentText) {
      const parsed = JSON.parse(contentText);
      if (parsed.topLabel && parsed.headline && parsed.subtext) {
        return parsed as ScreenVisionResult;
      }
    }
  } catch (err: any) {
    console.warn(`[Vision AI] OpenAI Vision call error:`, err?.message || err);
  }
  return null;
}

/**
 * Call Google Gemini Vision (gemini-1.5-flash / gemini-2.5-flash) using native fetch
 */
async function callGeminiVision(
  apiKey: string,
  base64Data: string,
  prompt: string
): Promise<ScreenVisionResult | null> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.2
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Vision AI] Gemini Vision API returned ${res.status}:`, errText);
      return null;
    }

    const data: any = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      const cleanJson = text.replace(/```json|```/gi, "").trim();
      const parsed = JSON.parse(cleanJson);
      if (parsed.topLabel && parsed.headline && parsed.subtext) {
        return parsed as ScreenVisionResult;
      }
    }
  } catch (err: any) {
    console.warn(`[Vision AI] Gemini Vision call error:`, err?.message || err);
  }
  return null;
}

/**
 * Multi-provider vision dispatcher:
 * Uses Anthropic, OpenAI, or Google Gemini when API keys are set in environment.
 */
async function callUniversalVision(
  env: Record<string, string | undefined>,
  imagePath: string,
  appName: string,
  slideIndex: number,
  totalSlides: number,
  screenHint?: string
): Promise<ScreenVisionResult | null> {
  try {
    const optimizedBuffer = await sharp(imagePath)
      .resize({ width: 720, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    const base64Data = optimizedBuffer.toString("base64");

    const prompt = `You are a mobile App Store marketing copywriter.
Analyze this mobile application screenshot for "${appName}".
This is Slide ${slideIndex + 1} of ${totalSlides}.
Context/Goal: "${screenHint || "Core app feature"}".

Generate high-converting, punchy App Store marketing copy strictly matching the UI shown in this screenshot.
Guidelines:
- topLabel: 1 to 3 words, ALL UPPERCASE (e.g. INSTANT SCANNER, SCAN HISTORY, FAVORITES, APP SETTINGS, INGREDIENT SAFETY)
- headline: 3 to 6 words, active and inspiring, with a '\\n' dividing it into 2 lines (e.g. "Smart Camera &\\nInstant Detection" or "Organize & Review\\nEvery Scan")
- subtext: exactly 1 clear benefit-driven sentence explaining what this screen empowers the user to do.
- layoutVariant: choose "device-center" for hero/final slides, or "device-bottom" for feature focus.

Return strictly valid JSON:
{
  "topLabel": "...",
  "headline": "...",
  "subtext": "...",
  "layoutVariant": "device-bottom"
}`;

    // 1. Anthropic Vision API
    if (env.ANTHROPIC_API_KEY) {
      const result = await callClaudeVision(env.ANTHROPIC_API_KEY, base64Data, prompt);
      if (result) return result;
    }

    // 2. OpenAI Vision API
    if (env.OPENAI_API_KEY) {
      const result = await callOpenAIVision(env.OPENAI_API_KEY, base64Data, prompt);
      if (result) return result;
    }

    // 3. Google Gemini Vision API
    const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
    if (geminiKey) {
      const result = await callGeminiVision(geminiKey, base64Data, prompt);
      if (result) return result;
    }
  } catch (err: any) {
    console.warn(`[Vision AI] Error optimizing image for vision API:`, err?.message || err);
  }

  return null;
}

/**
 * Intelligent Vision Semantic Engine
 * Derives accurate, high-conversion copy tailored directly to the verified screen content
 */
function deriveSemanticVisionCopy(
  fileName: string,
  slideIndex: number,
  totalSlides: number,
  appName: string,
  marketing?: any,
  goal?: { target: string; instruction: string; primaryText?: string }
): ScreenVisionResult {
  const shortDesc = marketing?.shortDescription || "Fast, intuitive, and modern mobile experience.";
  const target = (goal?.target || "").toLowerCase();
  const primary = (goal?.primaryText || goal?.target || "").toLowerCase();
  const instruction = (goal?.instruction || "").toLowerCase();
  // Strip noisy generic app-footer nav bar labels if present so active screen heading wins
  const filteredBody = instruction
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s && !/^(dash|home|clients|visits|catalog|orders|scan|history|favorites|profile|settings)$/i.test(s))
    .join(" | ");
  const focusContext = `${target} ${primary} ${filteredBody}`.trim();
  const context = `${focusContext} ${fileName}`.toLowerCase();

  // Layouts conform 100% to Apple App Store Review Guidelines:
  // Clean hero on first and last slide; clean upright device-bottom on feature slides.
  const isHero = slideIndex === 0 || (slideIndex === totalSlides - 1 && totalSlides > 3);
  const layoutVariant = isHero ? "device-center" : "device-bottom";

  const cleanTarget = goal?.target || (slideIndex === 0 ? "Welcome" : `Feature ${slideIndex + 1}`);

  // 1. Initial Launch / Splash Screen / Check-in Hero
  if (slideIndex === 0) {
    if (/\b(check[- ]?in|office hours|gps location|shift)\b/i.test(context)) {
      return {
        topLabel: `${appName.toUpperCase()}`,
        headline: `Smart Attendance &\nGPS Check-In`,
        subtext: shortDesc || `Start your workday in one tap with verified GPS attendance.`,
        layoutVariant: "device-center"
      };
    }
    return {
      topLabel: `${appName.toUpperCase()}`,
      headline: `Welcome to\n${appName}`,
      subtext: shortDesc || `The complete mobile solution engineered for speed, simplicity, and performance.`,
      layoutVariant: "device-center"
    };
  }

  // 2. Match primary screen title / user hint FIRST (prevents secondary buttons like "Add Client" on dashboard from stealing focus)
  if (/\b(dashboard|overview|performance|achievement|quick actions?|target met|analytics|report)\b/i.test(primary)) {
    return {
      topLabel: "SMART DASHBOARD",
      headline: "Live Targets &\nQuick Actions",
      subtext: "Track daily achievements, check-ins, and key shortcuts at a glance.",
      layoutVariant: "device-bottom"
    };
  }
  if (/\b(product catalog|catalog|sku|stock status|distributor|inventory|nutraceutical)\b/i.test(primary)) {
    return {
      topLabel: "PRODUCT CATALOG",
      headline: "Browse Live Stock &\nSmart Pricing",
      subtext: "Search SKUs by distributor or category with instant stock visibility.",
      layoutVariant: "device-bottom"
    };
  }
  if (/\b(clients?|all clients|customer|pharma|trader|dealer|balance|credit)\b/i.test(primary)) {
    return {
      topLabel: "CLIENT DIRECTORY",
      headline: "Manage Every Client\nIn One Place",
      subtext: "Filter accounts, check outstanding balances, and view visit history in seconds.",
      layoutVariant: "device-bottom"
    };
  }
  if (/\b(my visits|visits?|visit type|check[- ]?in|approval|field|route|schedule)\b/i.test(primary)) {
    return {
      topLabel: "FIELD VISITS",
      headline: "Track Visits &\nCheck-In Live",
      subtext: "Log field check-ins, review approvals, and capture visit proof in real time.",
      layoutVariant: "device-bottom"
    };
  }
  if (/\b(orders?|ord-\d+|invoices?|cart|checkout|delivery)\b/i.test(primary)) {
    return {
      topLabel: "ORDER TRACKING",
      headline: "Create & Track Orders\nEffortlessly",
      subtext: "Monitor every order status, item count, and fulfillment update from anywhere.",
      layoutVariant: "device-bottom"
    };
  }

  // 3. Fallback scan across full extracted screen context
  if (/\b(dashboard|overview|performance|achievement|quick actions?|target met|analytics|report)\b/i.test(focusContext)) {
    return {
      topLabel: "SMART DASHBOARD",
      headline: "Live Targets &\nQuick Actions",
      subtext: "Track daily achievements, check-ins, and key shortcuts at a glance.",
      layoutVariant: "device-bottom"
    };
  }
  if (/\b(product catalog|catalog|sku|stock status|distributor|inventory|nutraceutical)\b/i.test(focusContext)) {
    return {
      topLabel: "PRODUCT CATALOG",
      headline: "Browse Live Stock &\nSmart Pricing",
      subtext: "Search SKUs by distributor or category with instant stock visibility.",
      layoutVariant: "device-bottom"
    };
  }
  if (/\b(clients?|all clients|customer|pharma|trader|dealer|balance|credit)\b/i.test(focusContext)) {
    return {
      topLabel: "CLIENT DIRECTORY",
      headline: "Manage Every Client\nIn One Place",
      subtext: "Filter accounts, check outstanding balances, and view visit history in seconds.",
      layoutVariant: "device-bottom"
    };
  }
  if (/\b(my visits|visits?|visit type|check[- ]?in|approval|field|route|schedule)\b/i.test(focusContext)) {
    return {
      topLabel: "FIELD VISITS",
      headline: "Track Visits &\nCheck-In Live",
      subtext: "Log field check-ins, review approvals, and capture visit proof in real time.",
      layoutVariant: "device-bottom"
    };
  }
  if (/\b(orders?|ord-\d+|invoices?|cart|checkout|delivery)\b/i.test(focusContext)) {
    return {
      topLabel: "ORDER TRACKING",
      headline: "Create & Track Orders\nEffortlessly",
      subtext: "Monitor every order status, item count, and fulfillment update from anywhere.",
      layoutVariant: "device-bottom"
    };
  }

  // 7. Scanner / Camera / Barcode Recognition
  if (/\b(scan|scanner|camera|capture|reticle|barcode|finder|qr)\b/i.test(context)) {
    return {
      topLabel: "INSTANT SCANNER",
      headline: "Smart Camera &\nInstant Detection",
      subtext: "Scan any barcode, label, or item in milliseconds with live camera recognition.",
      layoutVariant: "device-bottom"
    };
  }

  // 8. Scan History / Past Logs / Recents (strict word boundaries so "catalog"/"login" never match "log")
  if (/\b(scan history|history|recent|older|activity log|logs|record|records)\b/i.test(context)) {
    return {
      topLabel: "SCAN HISTORY",
      headline: "Organize & Review\nEvery Scan",
      subtext: "Keep a complete searchable log of all your previous scans and discoveries.",
      layoutVariant: "device-bottom"
    };
  }

  // 9. Favorites / Bookmarks / Saved Items
  if (/\b(fav|favorite|favorites|bookmark|saved|starred)\b/i.test(context)) {
    return {
      topLabel: "FAVORITES",
      headline: "Instant Access To\nYour Favorites",
      subtext: "Bookmark trusted products and keep your top choices one tap away.",
      layoutVariant: "device-bottom"
    };
  }

  // 10. Product Safety / Ingredient Insights
  if (/\b(safety|safe|ingredient|cleaner|water|nutrition|food|analysis)\b/i.test(context)) {
    return {
      topLabel: "SAFETY ANALYSIS",
      headline: "Instant Health &\nSafety Insights",
      subtext: "Clear ingredient analysis and safety ratings to make informed choices.",
      layoutVariant: "device-bottom"
    };
  }

  // 11. Settings / Account / Preferences / Profile
  if (/\b(settings?|preferences?|account|profile|config|privacy)\b/i.test(context)) {
    return {
      topLabel: "SETTINGS & CONTROLS",
      headline: "Personalized Controls\n& Preferences",
      subtext: "Manage your profile, fine-tune notification settings, and review privacy options.",
      layoutVariant: "device-bottom"
    };
  }

  // 12. Authentication / Login Screen
  if (/\b(login|log in|sign[- ]?in|auth|password|welcome back)\b/i.test(context)) {
    return {
      topLabel: "SECURE ACCESS",
      headline: "Fast Sign-In For\nYour Entire Team",
      subtext: "Protected authentication tailored for quick daily access on the go.",
      layoutVariant: "device-bottom"
    };
  }

  // Dynamic fallback using extracted UI heading if available
  const detectedHeading = cleanTarget && !/^screen\s+\d+$/i.test(cleanTarget)
    ? cleanTarget.split(/\s+/).slice(0, 3).join(" ")
    : `Feature ${slideIndex + 1}`;
  const titleHeading = detectedHeading.replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    topLabel: detectedHeading.toUpperCase(),
    headline: `${titleHeading}\nBuilt For Speed`,
    subtext: shortDesc || `Designed for seamless performance and rapid daily execution.`,
    layoutVariant: "device-bottom"
  };
}

/**
 * Main copywriter entry point.
 * Uses Anthropic, OpenAI, or Google Vision when API keys are present,
 * and falls back to the local UI-metadata semantic engine offline.
 */
export async function generateVisionMarketingCopy(
  files: string[],
  screenshotsDir: string,
  config: any
): Promise<SlideConfig[]> {
  const env = { ...process.env, ...loadDotEnv() };
  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(env.OPENAI_API_KEY);
  const hasGemini = Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  const appName = config?.marketing?.appName || config?.app?.appId?.split(".").pop()?.toUpperCase() || "MY APP";
  const goals = config?.captureGoals || [];
  const marketing = config?.marketing || {};

  if (hasAnthropic) {
    console.log(`[Vision Model] Anthropic Claude Vision API detected! Generating AI copy for ${files.length} screenshots...`);
  } else if (hasOpenAI) {
    console.log(`[Vision Model] OpenAI Vision API detected! Generating AI copy for ${files.length} screenshots...`);
  } else if (hasGemini) {
    console.log(`[Vision Model] Google Gemini Vision API detected! Generating AI copy for ${files.length} screenshots...`);
  } else {
    console.log(`[Copywriter] Offline mode active: analyzing ${files.length} screenshot(s) from UI metadata.`);
  }

  const slides: SlideConfig[] = [];

  for (let i = 0; i < files.length; i++) {
    const fileName = files[i];
    const imagePath = path.join(screenshotsDir, fileName);
    let goal: { target: string; instruction: string; primaryText?: string } | undefined = goals[i];
    const metaPath = path.join(screenshotsDir, fileName.replace(/\.png$/i, ".meta.json"));
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        const uiList: string[] = Array.isArray(meta.uiTexts) ? meta.uiTexts : [];
        const primaryText = uiList.slice(0, 4).join(" | ");
        const target = meta.hint || uiList[0] || goal?.target || `Screen ${i + 1}`;
        const instruction = [meta.hint, ...uiList].filter(Boolean).join(" | ");
        if (instruction || meta.hint) {
          goal = { target, instruction, primaryText };
        }
      } catch {}
    }
    const screenHint = goal ? `${goal.target}: ${goal.instruction}` : `Screen ${i + 1}`;

    let result: ScreenVisionResult | null = null;

    if ((hasAnthropic || hasOpenAI || hasGemini) && fs.existsSync(imagePath)) {
      result = await callUniversalVision(env, imagePath, appName, i, files.length, screenHint);
    }

    if (!result) {
      result = deriveSemanticVisionCopy(fileName, i, files.length, appName, marketing, goal);
    }

    slides.push({
      id: `slide_${i + 1}`,
      order: i,
      screenshotFileName: fileName,
      topLabel: result.topLabel,
      headline: result.headline,
      subtext: result.subtext,
      layoutVariant: result.layoutVariant,
      callout: result.callout
    });

    console.log(`   ✓ Slide ${i + 1} [${result.topLabel}]: "${result.headline.replace(/\n/g, " ")}"`);
  }

  return slides;
}
