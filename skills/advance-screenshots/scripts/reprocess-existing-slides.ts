import * as fs from 'fs';
import * as path from 'path';
import { processScreenshotCrossPlatform } from './system-bar-cropper.js';

async function main() {
  const targetApp = process.argv[2] || 'my-app';
  const pDir = path.resolve(process.cwd(), 'projects', targetApp, 'screenshots');
  const tDir = path.resolve(process.cwd(), 'template/public/screenshots');

  for (let i = 1; i <= 8; i++) {
    const raw = path.join(pDir, `slide-${i}.png`);
    if (fs.existsSync(raw)) {
      const pIos = path.join(pDir, `slide-${i}-ios.png`);
      const pAndroid = path.join(pDir, `slide-${i}-android.png`);
      const tIos = path.join(tDir, `slide-${i}-ios.png`);
      const tAndroid = path.join(tDir, `slide-${i}-android.png`);

      await processScreenshotCrossPlatform(raw, pIos, pAndroid, 'android', 'current_screen.xml');
      fs.copyFileSync(pIos, tIos);
      fs.copyFileSync(pAndroid, tAndroid);
      console.log(`✓ Processed slide-${i} -> [slide-${i}-ios.png, slide-${i}-android.png]`);
    }
  }

  // Update template/app-store-screenshots.json
  const appJsonPath = path.resolve('template/app-store-screenshots.json');
  if (fs.existsSync(appJsonPath)) {
    const state = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    if (state.slidesByDevice) {
      if (state.slidesByDevice.iphone) {
        state.slidesByDevice.iphone.forEach((slide: any, idx: number) => {
          const iosTarget = `/screenshots/slide-${idx + 1}-ios.png`;
          if (fs.existsSync(path.join(tDir, `slide-${idx + 1}-ios.png`))) {
            slide.screenshot = iosTarget;
          }
        });
      }
      if (state.slidesByDevice.android) {
        state.slidesByDevice.android.forEach((slide: any, idx: number) => {
          const androidTarget = `/screenshots/slide-${idx + 1}-android.png`;
          if (fs.existsSync(path.join(tDir, `slide-${idx + 1}-android.png`))) {
            slide.screenshot = androidTarget;
          }
        });
      }
      fs.writeFileSync(appJsonPath, JSON.stringify(state, null, 2), 'utf8');
      console.log('✓ Updated template/app-store-screenshots.json with store-specific targets!');
    }
  }

  const projectJsonPath = path.resolve(process.cwd(), 'projects', targetApp, 'app-store-screenshots.json');
  if (fs.existsSync(projectJsonPath) && fs.existsSync(appJsonPath)) {
    fs.copyFileSync(appJsonPath, projectJsonPath);
    console.log(`✓ Synced projects/${targetApp}/app-store-screenshots.json`);
  }
}

main().catch(console.error);

