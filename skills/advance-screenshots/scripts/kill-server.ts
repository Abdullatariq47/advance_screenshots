// scripts/kill-server.ts
import { execSync } from "child_process";

export function killProcessesOnPort(port = 3000): number {
  let count = 0;
  try {
    const netstatOut = execSync(`netstat -ano | findstr :${port}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    });

    const lines = netstatOut.split("\n").map(l => l.trim()).filter(l => l.includes(`:${port}`) && l.includes("LISTENING"));
    const pids = new Set<string>();

    for (const line of lines) {
      const parts = line.split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== "0" && pid !== String(process.pid)) {
        pids.add(pid);
      }
    }

    for (const pid of pids) {
      try {
        console.log(`🧹 Killing open server process on port ${port} (PID: ${pid})...`);
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
        count++;
      } catch {}
    }
  } catch {}
  return count;
}

export function cleanupOpenServers(): void {
  console.log("🔍 Checking for open editor servers...");
  const killed3000 = killProcessesOnPort(3000);
  const killed3001 = killProcessesOnPort(3001);

  const total = killed3000 + killed3001;
  if (total > 0) {
    console.log(`✓ Cleaned up ${total} open server process(es). Ports 3000 and 3001 are now free.`);
  } else {
    console.log("✓ No open servers detected. Ports 3000 and 3001 are free.");
  }
}

// Execute directly if run as main script
if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  cleanupOpenServers();
}
