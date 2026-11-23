// scripts/update-copy.ts
import * as fs from "fs";
import * as path from "path";
import { generateVisionMarketingCopy } from "./vision-copywriter.js";
import { buildAppStoreScreenshotsJson } from "./generate-project-state.js";

async function main() {
  const args = process.argv.slice(2);
  let appId = "";
  const appIdx = args.indexOf("--app");
  if (appIdx !== -1 && args[appIdx + 1]) {
    appId = args[appIdx + 1];
  } else {
    const rootConfigPath = path.resolve(process.cwd(), "pipeline.config.json");
    if (fs.existsSync(rootConfigPath)) {
      try {
        const rootCfg = JSON.parse(fs.readFileSync(rootConfigPath, "utf-8"));
        appId = rootCfg?.app?.appId;
      } catch {}
    }
  }

  if (!appId) {
    const projectsDir = path.resolve(process.cwd(), "projects");
    if (fs.existsSync(projectsDir)) {
      const dirs = fs.readdirSync(projectsDir).filter(f => fs.statSync(path.join(projectsDir, f)).isDirectory());
      if (dirs.length > 0) appId = dirs[0];
    }
  }

  if (!appId) {
    console.error("❌ No active project found. Specify --app <packageId>");
    process.exit(1);
  }

  const projectDir = path.resolve(process.cwd(), "projects", appId);
  const configPath = path.join(projectDir, "pipeline.config.json");
  if (!fs.existsSync(configPath)) {
    console.error(`❌ Project config not found: ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const projectScreenshotsDir = path.join(projectDir, "screenshots");

  if (!fs.existsSync(projectScreenshotsDir)) {
    console.error(`❌ Screenshots directory not found: ${projectScreenshotsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(projectScreenshotsDir)
    .filter(f => /^slide-\d+\.png$/.test(f))
    .sort((a, b) => parseInt(a.replace(/[^\d]/g, ""), 10) - parseInt(b.replace(/[^\d]/g, ""), 10));

  console.log(`Regenerating Vision Model marketing copy for ${files.length} screenshots in [${appId}]...`);
  const slides = await generateVisionMarketingCopy(files, projectScreenshotsDir, config);

  buildAppStoreScreenshotsJson(
    config.marketing.appName,
    config.marketing.themePreset,
    config.marketing.accentColor,
    slides
  );

  fs.copyFileSync("template/app-store-screenshots.json", path.join(projectDir, "app-store-screenshots.json"));
  console.log(`✓ Done! app-store-screenshots.json updated successfully for [${appId}].`);
}

main().catch(console.error);
