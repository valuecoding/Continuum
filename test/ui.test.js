import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { startServer } from "../src/server.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const GOALS = [
  "Acknowledge the incident and load durable context",
  "Diagnose likely failure mode from prior memories",
  "Apply remediation checklist",
  "Verify recovery and persist closing memory",
];

function tasksFor(status) {
  return GOALS.map((goal, index) => ({
    id: `task-${index + 1}`,
    session_id: SESSION_ID,
    step_index: index + 1,
    goal,
    status: status === "completed" || index < 2 ? "completed" : "pending",
    result:
      index === 0
        ? { note: "Context loaded from CockroachDB memory" }
        : index === 1
          ? { diagnosis: "Durable task cursor recovered" }
          : null,
  }));
}

function payload(status) {
  const completed = status === "completed";
  return {
    counts: {
      tasks: 4,
      completed: completed ? 4 : 2,
      memories: completed ? 3 : 2,
      events: completed ? 11 : 7,
    },
    session: { id: SESSION_ID, status },
    tasks: tasksFor(status),
    memories: [
      {
        kind: "decision",
        content: "Durable task cursor required",
        metadata: { embed_provider: "bedrock" },
        distance: 0.221,
      },
    ],
    log: completed
      ? "Invocation B loaded the session → completed"
      : "Invocation A stopped after committed step 2",
  };
}

async function blockRemoteFonts(page) {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
}

test("browser proof isolates and resumes its own session", async (context) => {
  const { server, url } = await startServer({ port: 0 });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let resumeHeader = null;
  let crashHeader = null;

  context.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    await blockRemoteFonts(page);
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname;
      let body;

      if (endpoint === "/api/status") {
        body = {
          counts: { tasks: 0, completed: 0, memories: 0, events: 0 },
          session: null,
          tasks: [],
          memories: [],
          log: "No mission in this browser yet.",
        };
      } else if (endpoint === "/api/crash") {
        crashHeader = request.headers()["x-continuum-session"] || null;
        body = payload("crashed");
      } else if (endpoint === "/api/resume") {
        resumeHeader = request.headers()["x-continuum-session"];
        body = payload("completed");
      } else {
        body = payload("completed");
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.phase === "ready");

    const semantics = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map(
        (element) => element.id
      );
      const headingLevels = [...document.querySelectorAll("h1,h2,h3")].map(
        (heading) => Number(heading.tagName.slice(1))
      );
      const recall = document.getElementById("recall");
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        duplicates: ids.filter(
          (id, index) => ids.indexOf(id) !== index
        ),
        unnamedButtons: [...document.querySelectorAll("button")].filter(
          (button) =>
            !button.textContent.trim() &&
            !button.getAttribute("aria-label")
        ).length,
        headingLevels,
        recallScrollbarWidth: getComputedStyle(
          recall,
          "::-webkit-scrollbar"
        ).width,
        recallScrollbarButton: getComputedStyle(
          recall,
          "::-webkit-scrollbar-button"
        ).display,
      };
    });
    const headingSkips = semantics.headingLevels.some(
      (level, index, levels) =>
        index > 0 && level > levels[index - 1] + 1
    );

    assert.ok(semantics.documentWidth <= semantics.viewportWidth);
    assert.deepEqual(semantics.duplicates, []);
    assert.equal(semantics.unnamedButtons, 0);
    assert.equal(headingSkips, false);
    assert.equal(semantics.recallScrollbarWidth, "8px");
    assert.equal(semantics.recallScrollbarButton, "none");

    await page.locator("#btn-crash").click();
    await page.waitForFunction(() => document.body.dataset.phase === "crashed");
    assert.equal(crashHeader, null);
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem("continuum.client-session")
      ),
      SESSION_ID
    );
    assert.match(
      await page.locator("#phase-text").textContent(),
      /step 02 committed/i
    );
    await page.waitForFunction(() => {
      const proof = document.getElementById("proof-console");
      const header = document.querySelector(".top");
      if (!proof || !header) return false;
      const expectedTop = header.getBoundingClientRect().bottom + 12;
      return Math.abs(proof.getBoundingClientRect().top - expectedTop) < 3;
    });
    assert.match(
      await page.locator("#btn-resume-label").textContent(),
      /resume invocation b/i
    );
    assert.equal(await page.locator("#btn-resume").isEnabled(), true);

    await page.locator("#btn-resume").click();
    await page.waitForFunction(() => document.body.dataset.phase === "completed");
    assert.equal(resumeHeader, SESSION_ID);
    assert.equal(await page.locator("#stat-completed").textContent(), "4/4");
    assert.equal(await page.locator("#stat-provider").textContent(), "Bedrock");
    assert.match(
      await page.locator("#btn-resume-label").textContent(),
      /recovery verified/i
    );

    await page.mouse.move(1, 1);
    await page.locator("#architecture").scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      document.getElementById("arch-story").classList.contains("is-playing")
    );
    const architectureReadability = await page.evaluate(() => {
      const overflow = [];
      const groups = document.querySelectorAll(
        ".arch-node, .edge-tag, .inspection-tag"
      );
      for (const group of groups) {
        const rect = group.querySelector("rect");
        if (!rect) continue;
        const container = rect.getBBox();
        for (const label of group.querySelectorAll("text")) {
          const box = label.getBBox();
          if (
            box.x < container.x - 1 ||
            box.x + box.width > container.x + container.width + 1 ||
            box.y < container.y - 1 ||
            box.y + box.height > container.y + container.height + 1
          ) {
            overflow.push(label.textContent.trim());
          }
        }
      }

      const minimumFontSelectors = [
        ".runtime-card > span",
        ".session-meta",
        ".panel-label",
        ".arch-kicker",
        ".arch-legend",
        ".arch-tour-status",
        ".tool-index",
      ];
      const undersized = minimumFontSelectors.filter(
        (selector) =>
          parseFloat(
            getComputedStyle(document.querySelector(selector)).fontSize
          ) < 10.8
      );

      return {
        overflow,
        undersized,
        nodeKickerSize: parseFloat(
          getComputedStyle(
            document.querySelector(".arch-node .node-kicker")
          ).fontSize
        ),
      };
    });
    assert.deepEqual(architectureReadability.overflow, []);
    assert.deepEqual(architectureReadability.undersized, []);
    assert.ok(architectureReadability.nodeKickerSize >= 16);

    await page.waitForTimeout(650);
    await page.locator(".arch-figure").hover();
    await page.waitForTimeout(80);
    const pausedProgress = await page.evaluate(() => {
      const bar = document.getElementById("arch-progress-bar");
      return bar.getBoundingClientRect().width / bar.parentElement.clientWidth;
    });
    await page.waitForTimeout(320);
    const heldProgress = await page.evaluate(() => {
      const bar = document.getElementById("arch-progress-bar");
      return bar.getBoundingClientRect().width / bar.parentElement.clientWidth;
    });
    assert.ok(pausedProgress > 0.05);
    assert.ok(Math.abs(heldProgress - pausedProgress) < 0.015);

    await page.locator("#arch-stage-title").hover();
    await page.waitForTimeout(80);
    const resumedProgress = await page.evaluate(() => {
      const bar = document.getElementById("arch-progress-bar");
      return bar.getBoundingClientRect().width / bar.parentElement.clientWidth;
    });
    await page.waitForTimeout(320);
    const advancedProgress = await page.evaluate(() => {
      const bar = document.getElementById("arch-progress-bar");
      return bar.getBoundingClientRect().width / bar.parentElement.clientWidth;
    });
    assert.ok(resumedProgress >= pausedProgress - 0.015);
    assert.ok(advancedProgress > resumedProgress + 0.025);

    await page.locator("#arch-tab-0").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator("#arch-tab-1").getAttribute("aria-selected"),
      "true"
    );
    assert.match(
      await page.locator("#arch-caption").textContent(),
      /runtime sends memory text to Amazon Bedrock/i
    );
    assert.equal(
      await page.locator("#arch-tour-status").textContent(),
      "Manual view"
    );

    await page.locator("#btn-arch-replay").click();
    assert.equal(
      await page.locator("#arch-tab-0").getAttribute("aria-selected"),
      "true"
    );
    assert.equal(
      await page.locator("#arch-tour-status").textContent(),
      "Auto-playing"
    );
    assert.equal(
      await page.locator("#arch-story").evaluate((element) =>
        element.classList.contains("is-playing")
      ),
      true
    );

    await page.close();
  }

  const errorPage = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  await blockRemoteFonts(errorPage);
  await errorPage.route("**/api/**", async (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint === "/api/status") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          counts: { tasks: 0, completed: 0, memories: 0, events: 0 },
          session: null,
          tasks: [],
          memories: [],
          log: "No mission in this browser yet.",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Too many demo requests. Try again in a minute.",
      }),
    });
  });
  await errorPage.goto(url, { waitUntil: "domcontentloaded" });
  await errorPage.waitForFunction(() => document.body.dataset.phase === "ready");
  await errorPage.locator("#btn-crash").click();
  await errorPage.waitForFunction(
    () => document.getElementById("phase-banner").dataset.phase === "error"
  );
  assert.match(
    await errorPage.locator("#phase-text").textContent(),
    /too many demo requests/i
  );
  assert.equal(await errorPage.locator("#btn-crash").isEnabled(), true);
  await errorPage.close();
});
