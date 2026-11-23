// scripts/install-skill.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

function copyFolderRecursive(source: string, target: string) {
  if (!fs.existsSync(source)) return;
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const items = fs.readdirSync(source, { withFileTypes: true });
  for (const item of items) {
    if (item.name === "node_modules" || item.name === ".git" || item.name === ".next") continue;

    const srcPath = path.join(source, item.name);
    const destPath = path.join(target, item.name);

    if (item.isDirectory()) {
      copyFolderRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function install() {
  const args = process.argv.slice(2);
  let mode: "global" | "project" | undefined;
  let customProjectPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--global" || args[i] === "-g") mode = "global";
    if (args[i] === "--project" || args[i] === "-p") {
      mode = "project";
      if (args[i + 1] && !args[i + 1].startsWith("-")) {
        customProjectPath = args[i + 1];
      }
    }
  }

  const homeDir = os.homedir();
  const rootDir = process.cwd();

  // If no flag passed, prompt user interactively
  if (!mode && process.stdin.isTTY) {
    console.log("\n==========================================================");
    console.log("Advance Screenshots - Skill Installation Setup");
    console.log("==========================================================");
    console.log("Where would you like to install the skill?\n");
    console.log("  1) Global AI Skill (Recommended)");
    console.log("     • Installs into Claude Code & Antigravity globally");
    console.log("     • Available in ANY folder or project across your computer");
    console.log("     • Just say: 'Capture screenshots for my app com.example.app'");
    console.log("");
    console.log("  2) Current Project (.agents/skills/advance-screenshots)");
    console.log("     • Keeps skill isolated inside this workspace");
    console.log("     • Version-controlled with your repository");
    console.log("");
    console.log("  3) Custom Project Path (e.g. /path/to/my-flutter-app)");

    const rl = readline.createInterface({ input, output });
    const ans = await rl.question("\nSelect option (1, 2, or 3) [1]: ");
    const trimmed = ans.trim();

    if (trimmed === "2") {
      mode = "project";
    } else if (trimmed === "3") {
      mode = "project";
      const customPathAns = await rl.question("Enter project directory path: ");
      customProjectPath = customPathAns.trim() || undefined;
    } else {
      mode = "global";
    }
    rl.close();
  }

  if (!mode) mode = "global";

  const sourceFiles = [
    "SKILL.md",
    "copy-ideas.md",
    "iphone-duo.md",
    "mockup.png",
    "style-prompts.md",
    "package.json",
    "setup.sh",
    "setup.ps1"
  ];

  const sourceDirs = [
    "scripts",
    "template",
    "style-prompts"
  ];

  if (mode === "global") {
    console.log("\n[*] Installing Advance Screenshots as a Global AI Skill...");

    const globalTargets = [
      path.join(homeDir, ".claude", "skills", "advance-screenshots"),
      path.join(homeDir, ".gemini", "config", "skills", "advance-screenshots")
    ];

    for (const targetDir of globalTargets) {
      console.log(`   👉 Syncing to: ${targetDir}`);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Copy essential files
      for (const f of sourceFiles) {
        const src = path.join(rootDir, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(targetDir, f));
        }
      }

      // Copy directories
      for (const d of sourceDirs) {
        const srcDir = path.join(rootDir, d);
        if (fs.existsSync(srcDir)) {
          copyFolderRecursive(srcDir, path.join(targetDir, d));
        }
      }

      // Install dependencies if package.json exists in target
      const targetPkg = path.join(targetDir, "package.json");
      if (fs.existsSync(targetPkg) && !fs.existsSync(path.join(targetDir, "node_modules"))) {
        try {
          console.log(`   📦 Installing dependencies in ${path.basename(targetDir)}...`);
          execSync(`npm install --prefix "${targetDir}" --no-audit --no-fund --quiet`, { stdio: "ignore" });
        } catch {}
      }
    }

    console.log("\n==========================================================");
    console.log("✓ Successfully Installed Globally!");
    console.log("==========================================================");
    console.log("Installed Locations:");
    console.log(`  • Claude Code          : ${globalTargets[0]}`);
    console.log(`  • Google Antigravity   : ${globalTargets[1]}`);
    console.log("\nYou can now open ANY project on your machine and simply ask:");
    console.log('  "Capture screens for app com.example.app and create store screenshots."');
    console.log("==========================================================\n");
  } else {
    // Project-level installation
    const baseProjectDir = customProjectPath ? path.resolve(customProjectPath) : rootDir;
    const projectSkillDir = path.join(baseProjectDir, ".agents", "skills", "advance-screenshots");
    const claudeProjectSkillDir = path.join(baseProjectDir, ".claude", "skills", "advance-screenshots");

    console.log(`\n[*] Installing Advance Screenshots into Project: ${baseProjectDir}...`);

    for (const targetDir of [projectSkillDir, claudeProjectSkillDir]) {
      console.log(`   👉 Syncing to: ${targetDir}`);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      for (const f of sourceFiles) {
        const src = path.join(rootDir, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(targetDir, f));
        }
      }

      for (const d of sourceDirs) {
        const srcDir = path.join(rootDir, d);
        if (fs.existsSync(srcDir)) {
          copyFolderRecursive(srcDir, path.join(targetDir, d));
        }
      }
    }

    console.log("\n==========================================================");
    console.log("✓ Successfully Installed within Project!");
    console.log("==========================================================");
    console.log(`Skill Directory: ${projectSkillDir}`);
    console.log("\nYour project's AI agent (Cursor, Windsurf, Claude Code) will now");
    console.log("automatically detect and use the skill within this repository.");
    console.log("==========================================================\n");
  }
}

install().catch(console.error);
