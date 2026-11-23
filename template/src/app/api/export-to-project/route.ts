// template/src/app/api/export-to-project/route.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import JSZip from "jszip";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as Blob | null;
    const appId = (formData.get("appId") as string) || "";
    const appName = (formData.get("appName") as string) || "";
    const customDest = (formData.get("destFolder") as string) || "";

    if (!file) {
      return NextResponse.json({ ok: false, error: "Missing file payload" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine target directory
    let targetDir = "";
    if (customDest && customDest.trim()) {
      targetDir = path.resolve(customDest.trim());
    } else {
      const rootDir = path.resolve(process.cwd(), "..");
      let projectFolder = appId;

      if (!projectFolder) {
        // Attempt to read active package from pipeline.config.json
        try {
          const configPath = path.join(rootDir, "pipeline.config.json");
          const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
          projectFolder = config?.app?.appId;
        } catch {}
      }

      if (!projectFolder) {
        projectFolder = appName.toLowerCase().replace(/[^a-z0-9]/g, "-") || "default-app";
      }

      targetDir = path.join(rootDir, "projects", projectFolder, "ScreenShots");
    }

    await fs.mkdir(targetDir, { recursive: true });

    // Extract all image files from the zip into targetDir
    const zip = await JSZip.loadAsync(buffer);
    let extractedCount = 0;

    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;
      const fullPath = path.join(targetDir, relativePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      const content = await zipEntry.async("nodebuffer");
      await fs.writeFile(fullPath, content);
      extractedCount++;
    }

    console.log(`[Export API] Successfully extracted ${extractedCount} screenshots to ${targetDir}`);

    return NextResponse.json({
      ok: true,
      targetDir,
      extractedCount,
      message: `Exported ${extractedCount} screenshots directly to ${targetDir}`
    });
  } catch (err: any) {
    console.error("[Export API Error]", err);
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}

