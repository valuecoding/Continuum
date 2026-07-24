import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { closePool } from "../src/db/client.js";
import { startServer } from "../src/server.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(projectDirectory, "docs/images");
const socialImagePath = path.join(projectDirectory, "public/og.png");
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
  await page.waitForSelector("#btn-crash:not([disabled])", { timeout: 60_000 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(outputDirectory, "landing.png"),
    fullPage: false,
  });

  await page.locator("#btn-crash").click();
  await waitStatus(page, "crashed");
  await page.locator("#proof-console").evaluate((el) =>
    el.scrollIntoView({ behavior: "instant", block: "start" })
  );
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(outputDirectory, "crashed.png"),
    fullPage: false,
  });

  await page.locator("#btn-resume").click();
  await waitStatus(page, "completed");
  await page.locator("#proof-console").evaluate((el) =>
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

  const socialPage = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await socialPage.goto(url, { waitUntil: "networkidle" });
  await socialPage.waitForSelector(".hero h1", { state: "visible" });
  await socialPage.addStyleTag({
    content: `
      html, body { width: 1200px; min-height: 630px; overflow: hidden; }
      .top { position: relative; }
      .top-inner { width: 1040px; }
      .hero { width: 1040px; padding: 58px 0 0; }
      .hero-grid { grid-template-columns: 0.92fr 1.08fr; gap: 48px; }
      .hero h1 { font-size: 64px; max-width: 11ch; }
      .hero-sub { margin-top: 18px; font-size: 16px; line-height: 1.5; }
      .cta, .hint, .hero-facts { display: none; }
      .proof, .architecture, .readiness, .foot { display: none; }
      .continuity-card { padding: 14px; border-radius: 24px; }
      .continuity-head { padding-bottom: 10px; }
      .handoff-map { min-height: 238px; padding: 18px 4px; }
      .runtime-card { min-height: 108px; }
      .memory-core { min-height: 168px; }
      .checkpoint-ledger > div { padding: 9px 10px; }
    `,
  });
  await socialPage.evaluate(() => window.scrollTo(0, 0));
  await socialPage.screenshot({ path: socialImagePath });
  await socialPage.close();

  console.log(
    `Preview screenshots written to ${outputDirectory}; social image written to ${socialImagePath}`
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await closePool();
}
