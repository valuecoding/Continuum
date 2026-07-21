import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { closePool } from "../src/db/client.js";
import { startServer } from "../src/server.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const videoRoot = path.join(projectRoot, "artifacts", "video");
const outputPath = path.join(videoRoot, "continuum-demo-silent.webm");
const scenes = JSON.parse(
  await fs.readFile(path.join(projectRoot, "docs", "video", "narration.json"), "utf8")
);
await fs.mkdir(videoRoot, { recursive: true });

const WIDTH = 1920;
const HEIGHT = 1080;

function probeDuration(filePath) {
  return Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { encoding: "utf8" }
    ).trim()
  );
}

async function installCinemaLayer(page) {
  const css = await fs.readFile(
    path.join(projectRoot, "public", "cinema.css"),
    "utf8"
  );
  await page.addStyleTag({ content: css });
  await page.evaluate(() => {
    document.documentElement.classList.add("cinema");

    if (!document.getElementById("cinema-endcard")) {
      const endcard = document.createElement("div");
      endcard.id = "cinema-endcard";
      endcard.innerHTML = `
        <div>
          <p class="brand">CONTINUUM</p>
          <h1>Memory is the product.</h1>
          <p>CockroachDB · Amazon Bedrock · MCP</p>
        </div>
      `;
      document.body.append(endcard);
    }

    window.__continuumCinema = {
      clearFocus() {
        for (const el of document.querySelectorAll(".cinema-focus, .cinema-focus-click")) {
          el.classList.remove("cinema-focus", "cinema-focus-click");
        }
      },
      focus(selector) {
        this.clearFocus();
        const el = document.querySelector(selector);
        if (!el) return;
        el.classList.add("cinema-focus");
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      },
      markClick(selector) {
        const el = document.querySelector(selector);
        if (!el) return;
        el.classList.add("cinema-focus", "cinema-focus-click");
      },
      showEndcard() {
        this.clearFocus();
        document.getElementById("cinema-endcard")?.classList.add("show");
      },
    };
  });
}

async function smoothScrollTo(page, locator, block = "center") {
  await locator.evaluate((element, scrollBlock) => {
    element.scrollIntoView({ behavior: "smooth", block: scrollBlock });
  }, block);
  await page.waitForTimeout(850);
}

async function focusSelector(page, selector) {
  await page.evaluate((sel) => window.__continuumCinema?.focus(sel), selector);
  await page.waitForTimeout(650);
}

async function clickExact(page, selector) {
  await focusSelector(page, selector);
  await page.evaluate((sel) => window.__continuumCinema?.markClick(sel), selector);
  await page.waitForTimeout(180);
  // Click the real element center — no fake cursor, no transform offset
  await page.locator(selector).click({ delay: 70 });
  await page.waitForTimeout(320);
}

async function waitForTimelineStatus(page, statusSubstring, timeout = 60_000) {
  await page.waitForFunction(
    (needle) => {
      const meta = document.getElementById("session-meta");
      return meta && meta.textContent.toLowerCase().includes(needle);
    },
    statusSubstring,
    { timeout }
  );
}

async function playScene(page, sceneId, durations, action) {
  const startedAt = Date.now();
  if (action) await action();
  const remaining = Math.max(
    500,
    durations.get(sceneId) * 1000 - (Date.now() - startedAt)
  );
  await page.waitForTimeout(remaining);
}

const durations = new Map(
  scenes.map((scene, index) => [
    scene.id,
    probeDuration(
      path.join(
        videoRoot,
        "audio",
        `${String(index).padStart(2, "0")}-${scene.id}.wav`
      )
    ),
  ])
);

const { server, url } = await startServer({ port: 0 });
const browser = await chromium.launch({
  channel: process.env.CONTINUUM_BROWSER_CHANNEL || "chrome",
  headless: true,
  args: [
    "--force-device-scale-factor=1",
    "--high-dpi-support=1",
    `--window-size=${WIDTH},${HEIGHT}`,
  ],
});

const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  screen: { width: WIDTH, height: HEIGHT },
  recordVideo: {
    dir: videoRoot,
    size: { width: WIDTH, height: HEIGHT },
  },
});
const page = await context.newPage();

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await installCinemaLayer(page);
  await page.waitForTimeout(600);

  for (const scene of scenes) {
    if (scene.id === "hero") {
      await playScene(page, scene.id, durations, async () => {
        await page.evaluate(() => window.__continuumCinema?.clearFocus());
        await page.evaluate(() =>
          window.scrollTo({ top: 0, behavior: "smooth" })
        );
        await focusSelector(page, ".hero .brand");
      });
    } else if (scene.id === "problem") {
      await playScene(page, scene.id, durations, async () => {
        await focusSelector(page, ".hero h1");
        await page.waitForTimeout(400);
        await focusSelector(page, ".cta");
      });
    } else if (scene.id === "architecture") {
      await playScene(page, scene.id, durations, async () => {
        await smoothScrollTo(page, page.locator("#architecture"), "center");
        await focusSelector(page, ".arch");
      });
    } else if (scene.id === "crash") {
      await playScene(page, scene.id, durations, async () => {
        await page.evaluate(() =>
          window.scrollTo({ top: 0, behavior: "smooth" })
        );
        await page.waitForTimeout(500);
        await clickExact(page, "#btn-crash");
        await waitForTimelineStatus(page, "crashed");
        await focusSelector(page, "#timeline");
      });
    } else if (scene.id === "memory") {
      await playScene(page, scene.id, durations, async () => {
        await focusSelector(page, "#timeline");
        await page.waitForTimeout(500);
        await focusSelector(page, "#recall");
      });
    } else if (scene.id === "resume") {
      await playScene(page, scene.id, durations, async () => {
        await clickExact(page, "#btn-resume");
        await waitForTimelineStatus(page, "completed");
        await focusSelector(page, "#timeline");
      });
    } else if (scene.id === "completed") {
      await playScene(page, scene.id, durations, async () => {
        await focusSelector(page, "#timeline");
        await page.waitForTimeout(400);
        await focusSelector(page, "#stats");
      });
    } else if (scene.id === "closing") {
      await playScene(page, scene.id, durations, async () => {
        await page.evaluate(() => window.__continuumCinema?.showEndcard());
        await page.waitForTimeout(700);
      });
    }
  }
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await closePool();

  if (video) {
    const tempPath = await video.path();
    await fs.copyFile(tempPath, outputPath);
    await fs.unlink(tempPath).catch(() => {});
  }
}

console.log(`Created silent demo recording at ${outputPath}`);
