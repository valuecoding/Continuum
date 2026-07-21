import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { closePool } from "../src/db/client.js";
import { startServer } from "../src/server.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(scriptDirectory, "../docs/images");
await fs.mkdir(outputDirectory, { recursive: true });

const { server, url } = await startServer({ port: 0 });
const browser = await chromium.launch({
  channel: process.env.CONTINUUM_BROWSER_CHANNEL || "chrome",
  headless: true,
  args: ["--force-device-scale-factor=1"],
});

async function waitStatus(page, needle) {
  await page.waitForFunction(
    (text) => {
      const meta = document.getElementById("session-meta");
      return meta && meta.textContent.toLowerCase().includes(text);
    },
    needle,
    { timeout: 60_000 }
  );
}

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(outputDirectory, "landing.png"),
    fullPage: false,
  });

  await page.locator("#btn-crash").click();
  await waitStatus(page, "crashed");
  await page.locator("#proof").evaluate((el) =>
    el.scrollIntoView({ behavior: "instant", block: "start" })
  );
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(outputDirectory, "crashed.png"),
    fullPage: false,
  });

  await page.locator("#btn-resume").click();
  await waitStatus(page, "completed");
  await page.locator("#proof").evaluate((el) =>
    el.scrollIntoView({ behavior: "instant", block: "start" })
  );
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(outputDirectory, "resumed.png"),
    fullPage: false,
  });

  await page.locator("#architecture").evaluate((el) =>
    el.scrollIntoView({ behavior: "instant", block: "start" })
  );
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(outputDirectory, "architecture.png"),
    fullPage: false,
  });

  console.log(`Preview screenshots written to ${outputDirectory}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await closePool();
}
