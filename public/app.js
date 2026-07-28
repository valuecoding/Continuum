const timelineEl = document.getElementById("timeline");
const recallEl = document.getElementById("recall");
const logEl = document.getElementById("log");
const sessionMeta = document.getElementById("session-meta");
const phaseBanner = document.getElementById("phase-banner");
const phaseText = document.getElementById("phase-text");
const phaseChip = document.getElementById("phase-chip");
const hintEl = document.getElementById("hint");
const fxLayer = document.getElementById("fx-layer");
const continuityCard = document.getElementById("continuity-card");
const runtimeAState = document.getElementById("runtime-a-state");
const runtimeBState = document.getElementById("runtime-b-state");
const checkpointState = document.getElementById("checkpoint-state");
const handoffState = document.getElementById("handoff-state");
const btnCrash = document.getElementById("btn-crash");
const btnResume = document.getElementById("btn-resume");
const btnResumeLabel = document.getElementById("btn-resume-label");
const btnResumeDetail = document.getElementById("btn-resume-detail");
const proofConsole = document.getElementById("proof-console");
const stickyHeader = document.querySelector(".top");
const buttons = [...document.querySelectorAll("[data-action]")];

const archSvg = document.getElementById("arch-svg");
const archCaption = document.getElementById("arch-caption");
const archStageTitle = document.getElementById("arch-stage-title");
const archKicker = document.getElementById("arch-kicker");
const archSection = document.getElementById("architecture");
const archStory = document.getElementById("arch-story");
const archFigure = document.querySelector(".arch-figure");
const archPanel = document.getElementById("arch-panel");
const archProgressBar = document.getElementById("arch-progress-bar");
const archReplayButton = document.getElementById("btn-arch-replay");
const archTourStatus = document.getElementById("arch-tour-status");
const archStepBtns = [...document.querySelectorAll(".arch-step")];
const archNodes = [...document.querySelectorAll(".arch-node")];

const SESSION_KEY = "continuum.client-session";
const SESSION_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ARCH_STEPS = [
  {
    title: "Commit the task cursor",
    copy:
      "Invocation A writes session, task, and event rows before the failure boundary. Completed steps will not run again.",
    hot: ["runtime-a", "crdb"],
    dwellMs: 5200,
  },
  {
    title: "Request the embedding",
    copy:
      "The runtime sends memory text to Amazon Bedrock Titan Embeddings V2 and receives a normalized 1024-dimensional vector.",
    hot: ["runtime-a", "bedrock"],
    dwellMs: 5200,
  },
  {
    title: "Commit the vector memory",
    copy:
      "The runtime stores content, metadata, provider, and VECTOR(1024) beside transactional state in CockroachDB.",
    hot: ["runtime-a", "bedrock", "crdb"],
    dwellMs: 5400,
  },
  {
    title: "Recover in invocation B",
    copy:
      "A fresh request loads the same client-scoped session, skips committed work, recalls memory, and continues at step three.",
    hot: ["crdb", "runtime-b"],
    dwellMs: 5400,
  },
];

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

let currentPhase = "ready";
let lastRunMode = "recovery";
let busy = false;
let archAutoplay = !reduceMotion;
let archTimer = null;
let archDeadline = 0;
let archRemainingMs = null;
let archIndex = 0;
let archInView = false;
let archHoverPaused = false;
let archFocusPaused = false;

function storedSessionId() {
  try {
    const value = window.sessionStorage.getItem(SESSION_KEY);
    return value && SESSION_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

function storeSessionId(sessionId) {
  if (!SESSION_PATTERN.test(String(sessionId || ""))) return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, sessionId);
  } catch {
    // The demo still works until refresh when storage is unavailable.
  }
}

function syncActions() {
  if (busy) return;
  for (const btn of buttons) btn.disabled = false;
  btnResume.disabled = currentPhase !== "crashed";
}

function setBusy(nextBusy) {
  busy = nextBusy;
  for (const btn of buttons) btn.disabled = nextBusy;
  if (!nextBusy) syncActions();
}

function flashCrash() {
  if (!fxLayer || reduceMotion) return;
  fxLayer.classList.remove("is-crash");
  void fxLayer.offsetWidth;
  fxLayer.classList.add("is-crash");
  window.setTimeout(() => fxLayer.classList.remove("is-crash"), 650);
}

function showApiError(message) {
  phaseBanner.dataset.phase = "error";
  phaseText.textContent = message;
}

function setPhase(phase, { sessionId = null, mode = lastRunMode } = {}) {
  currentPhase = phase;
  lastRunMode = mode;
  const shortId = sessionId ? sessionId.slice(0, 8) : null;

  document.body.dataset.phase = phase;
  phaseBanner.dataset.phase = phase;
  continuityCard.dataset.phase = phase;
  phaseChip.textContent = phase;
  btnResume.classList.toggle("is-pulse", phase === "crashed");

  if (phase === "running") {
    phaseText.textContent =
      "Invocation A is writing checkpoints and vector memory.";
    runtimeAState.textContent = "running";
    runtimeBState.textContent = "standby";
    checkpointState.textContent = "writing";
    handoffState.textContent = "pending";
    hintEl.innerHTML =
      "<span>Running</span> Durable writes are in flight. The proof will stop after step 02.";
    btnResumeLabel.textContent = "Writing checkpoints";
    btnResumeDetail.textContent = "Invocation A is in progress";
  } else if (phase === "crashed") {
    phaseText.textContent = shortId
      ? `Invocation A stopped · step 02 committed · ${shortId}`
      : "Invocation A stopped after committed step 02.";
    runtimeAState.textContent = "stopped after 02";
    runtimeBState.textContent = "ready to recover";
    checkpointState.textContent = "step 02 / 04";
    handoffState.textContent = "available";
    hintEl.innerHTML =
      "<span>Next</span> Start invocation B. It will load this exact session and continue at step 03.";
    btnResumeLabel.textContent = "Resume invocation B";
    btnResumeDetail.textContent = "Continue at step 03";
  } else if (phase === "completed" && mode === "full") {
    phaseText.textContent = shortId
      ? `Single invocation completed all four steps · ${shortId}`
      : "Single invocation completed all four steps.";
    runtimeAState.textContent = "completed 04 / 04";
    runtimeBState.textContent = "not used";
    checkpointState.textContent = "step 04 / 04";
    handoffState.textContent = "not required";
    hintEl.innerHTML =
      "<span>Complete</span> Run the crash proof next to demonstrate the recovery boundary.";
    btnResumeLabel.textContent = "Single run complete";
    btnResumeDetail.textContent = "No recovery was required";
  } else if (phase === "completed") {
    phaseText.textContent = shortId
      ? `Invocation B resumed at step 03 and completed · ${shortId}`
      : "Invocation B resumed from durable memory and completed.";
    runtimeAState.textContent = "stopped after 02";
    runtimeBState.textContent = "recovered · complete";
    checkpointState.textContent = "step 04 / 04";
    handoffState.textContent = "complete";
    hintEl.innerHTML =
      "<span>Verified</span> Invocation B skipped committed work and finished the same mission.";
    btnResumeLabel.textContent = "Recovery verified";
    btnResumeDetail.textContent = "4 / 4 steps committed";
  } else {
    phaseText.textContent = "Ready to create a client-scoped mission.";
    runtimeAState.textContent = "waiting";
    runtimeBState.textContent = "standby";
    checkpointState.textContent = "not started";
    handoffState.textContent = "not required";
    hintEl.innerHTML =
      "<span>Jury path</span> Crash first, then resume the same client-scoped session.";
    btnResumeLabel.textContent = "Resume invocation B";
    btnResumeDetail.textContent = "Available after the crash";
  }

  syncActions();
}

function taskDetail(task) {
  const result = task.result;
  if (!result || typeof result !== "object") return "";
  if (result.diagnosis) return result.diagnosis;
  if (result.summary) return result.summary;
  if (result.note) return result.note;
  if (Array.isArray(result.actions)) return result.actions.join(" · ");
  if (Array.isArray(result.remembered)) {
    return result.remembered.length
      ? `recalled ${result.remembered.length} prior memories`
      : "no prior memory required";
  }
  return "";
}

function renderStats(counts = {}, memories = []) {
  const completed = Number(counts.completed || 0);
  const total = Number(counts.tasks || 0);
  document.getElementById("stat-completed").textContent =
    `${completed}/${total}`;
  document.getElementById("stat-memories").textContent =
    String(counts.memories || 0);
  document.getElementById("stat-events").textContent =
    String(counts.events || 0);

  const providers = new Set(
    memories
      .map((memory) => memory.metadata?.embed_provider)
      .filter(Boolean)
  );
  const provider = providers.has("bedrock")
    ? "Bedrock"
    : providers.has("local")
      ? "Local"
      : "—";
  document.getElementById("stat-provider").textContent = provider;
}

function renderTimeline(session, tasks = []) {
  if (!session) {
    sessionMeta.textContent = "no client session";
    timelineEl.innerHTML =
      '<li class="empty">Run the crash proof to create durable steps.</li>';
    return;
  }

  sessionMeta.textContent =
    `client session ${session.id} · ${session.status}`;
  const firstPending = tasks.find(
    (task) => task.status === "pending" || task.status === "in_progress"
  );

  timelineEl.innerHTML = tasks
    .map((task) => {
      const detail = taskDetail(task);
      const isBreak =
        session.status === "crashed" &&
        Number(task.step_index) === 2 &&
        task.status === "completed";
      const isNext = Boolean(firstPending && task.id === firstPending.id);
      const classes = [
        escapeHtml(task.status),
        isBreak ? "is-break" : "",
        isNext ? "is-next" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `
        <li class="${classes}">
          <div class="step">step ${escapeHtml(task.step_index)}</div>
          <div>
            <div class="goal">${escapeHtml(task.goal)}</div>
            ${detail ? `<div class="detail">${escapeHtml(detail)}</div>` : ""}
            <div class="status">${escapeHtml(task.status)}</div>
          </div>
        </li>`;
    })
    .join("");
}

function renderRecall(memories = []) {
  if (!memories.length) {
    recallEl.innerHTML =
      '<li class="empty">Vector memories appear after the agent writes them.</li>';
    return;
  }

  const seen = new Set();
  const unique = memories.filter((memory) => {
    const key = String(memory.content || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  recallEl.innerHTML = unique
    .map((memory) => {
      const provider = String(
        memory.metadata?.embed_provider || "unknown"
      ).toLowerCase();
      const distance =
        memory.distance === undefined || memory.distance === null
          ? ""
          : `d=${Number(memory.distance).toFixed(3)}`;
      return `
        <li>
          <div class="memory-topline">
            <span class="memory-kind">${escapeHtml(memory.kind || "memory")}</span>
            <span class="memory-meta">
              <span class="memory-provider ${
                provider === "bedrock" ? "is-bedrock" : ""
              }">${escapeHtml(provider)}</span>
              ${
                distance
                  ? `<span class="memory-distance">${escapeHtml(distance)}</span>`
                  : ""
              }
            </span>
          </div>
          <p>${escapeHtml(memory.content)}</p>
        </li>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function applyPayload(data, action) {
  if (data.session?.id) storeSessionId(data.session.id);
  if (data.log) logEl.textContent = data.log;
  renderStats(data.counts || {}, data.memories || []);
  renderTimeline(data.session, data.tasks || []);
  renderRecall(data.memories || []);

  const status = data.session?.status || "ready";
  const mode = action === "full" ? "full" : lastRunMode;
  if (status === "crashed") {
    setPhase("crashed", { sessionId: data.session?.id, mode: "recovery" });
  } else if (status === "completed") {
    setPhase("completed", { sessionId: data.session?.id, mode });
  } else if (status === "running" || status === "paused") {
    setPhase("running", { sessionId: data.session?.id, mode });
  } else {
    setPhase("ready");
  }
}

async function call(action) {
  const previousPhase = currentPhase;
  const startsFresh = action === "crash" || action === "full";
  const sessionId = startsFresh ? null : storedSessionId();
  const headers = {};
  if (sessionId) headers["X-Continuum-Session"] = sessionId;

  setBusy(true);
  logEl.textContent = `Running ${action}…`;

  if (["crash", "resume", "full"].includes(action)) {
    lastRunMode = action === "full" ? "full" : "recovery";
    setPhase("running", { mode: lastRunMode });
    const headerHeight = stickyHeader?.getBoundingClientRect().height || 70;
    const targetTop =
      window.scrollY +
      proofConsole.getBoundingClientRect().top -
      headerHeight -
      12;
    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`/api/${action}`, {
      method: "POST",
      headers,
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || response.statusText);
    applyPayload(data, action);
    if (action === "crash") flashCrash();
  } catch (error) {
    const message =
      error.name === "AbortError"
        ? "Request timed out. Try again."
        : String(error.message || error);
    logEl.textContent = message;
    setPhase(previousPhase, {
      sessionId: storedSessionId(),
      mode: lastRunMode,
    });
    showApiError(message);
  } finally {
    window.clearTimeout(timeout);
    setBusy(false);
  }
}

function archTourBlocked() {
  return archHoverPaused || archFocusPaused;
}

function clearArchTimer() {
  if (!archTimer) return;
  window.clearTimeout(archTimer);
  archTimer = null;
  archDeadline = 0;
}

function syncArchPause() {
  archStory.classList.toggle(
    "is-paused",
    archAutoplay && archTourBlocked()
  );
  syncArchTourStatus();
}

function syncArchTourStatus() {
  if (archStory.classList.contains("is-complete")) {
    archTourStatus.textContent = "Tour complete";
  } else if (!archAutoplay) {
    archTourStatus.textContent = "Manual view";
  } else if (archTourBlocked()) {
    archTourStatus.textContent = "Paused for inspection";
  } else {
    archTourStatus.textContent = "Auto-playing";
  }
}

function restartArchProgress(dwellMs) {
  archStory.classList.remove("is-playing", "is-complete");
  archProgressBar.style.animationDuration = "";
  void archProgressBar.offsetWidth;
  if (!archAutoplay || reduceMotion) return;
  archProgressBar.style.animationDuration = `${dwellMs}ms`;
  archStory.classList.add("is-playing");
  syncArchPause();
}

function setArchStep(index) {
  const normalized =
    ((index % ARCH_STEPS.length) + ARCH_STEPS.length) % ARCH_STEPS.length;
  const step = ARCH_STEPS[normalized];
  archIndex = normalized;

  archSvg.dataset.step = "";
  void archSvg.getBoundingClientRect();
  archSvg.dataset.step = String(normalized);

  for (const button of archStepBtns) {
    const active = Number(button.dataset.step) === normalized;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  }

  archKicker.textContent =
    `Step ${String(normalized + 1).padStart(2, "0")} of 04`;
  archStageTitle.textContent = step.title;
  archCaption.textContent = step.copy;
  archPanel.setAttribute("aria-labelledby", `arch-tab-${normalized}`);

  for (const node of archNodes) {
    if (node.dataset.plane === "inspection") continue;
    const hot = step.hot.includes(node.dataset.node);
    node.classList.toggle("is-hot", hot);
    node.classList.toggle("is-dim", !hot);
  }
}

function stopArchTour() {
  clearArchTimer();
  archRemainingMs = null;
  archStory.classList.remove("is-playing", "is-paused", "is-complete");
  syncArchTourStatus();
}

function completeArchTour() {
  clearArchTimer();
  archAutoplay = false;
  archRemainingMs = null;
  archStory.classList.remove("is-playing", "is-paused");
  archStory.classList.add("is-complete");
  syncArchTourStatus();
}

function scheduleArchTour({ resume = false } = {}) {
  clearArchTimer();
  if (!archAutoplay || !archInView || archTourBlocked()) return;
  const canResume =
    resume &&
    archRemainingMs !== null &&
    archStory.classList.contains("is-playing");
  const dwell = canResume
    ? archRemainingMs
    : ARCH_STEPS[archIndex].dwellMs;
  if (!canResume) restartArchProgress(dwell);
  archRemainingMs = dwell;
  archDeadline = performance.now() + dwell;
  archTimer = window.setTimeout(() => {
    archTimer = null;
    archDeadline = 0;
    archRemainingMs = null;
    if (archIndex === ARCH_STEPS.length - 1) {
      completeArchTour();
      return;
    }
    setArchStep(archIndex + 1);
    scheduleArchTour();
  }, dwell);
}

function setArchAutoplay(nextAutoplay) {
  archAutoplay = Boolean(nextAutoplay) && !reduceMotion;
  if (archAutoplay) scheduleArchTour();
  else stopArchTour();
  syncArchTourStatus();
}

function replayArchTour() {
  clearArchTimer();
  archRemainingMs = null;
  archAutoplay = !reduceMotion;
  archStory.classList.remove("is-playing", "is-paused", "is-complete");
  setArchStep(0);
  if (archAutoplay) scheduleArchTour();
  syncArchTourStatus();
}

function setArchPaused(kind, paused) {
  const wasBlocked = archTourBlocked();
  if (kind === "hover") archHoverPaused = paused;
  if (kind === "focus") archFocusPaused = paused;
  const blocked = archTourBlocked();
  syncArchPause();
  if (!wasBlocked && blocked) {
    if (archTimer && archDeadline) {
      archRemainingMs = Math.max(0, archDeadline - performance.now());
    }
    clearArchTimer();
  } else if (wasBlocked && !blocked) {
    scheduleArchTour({ resume: true });
  }
}

function measureArchInView() {
  const rect = archSection.getBoundingClientRect();
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight;
  const visible =
    Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
  return visible >= Math.min(240, viewportHeight * 0.24);
}

function onArchVisibility(inView) {
  const entered = inView && !archInView;
  archInView = inView;
  if (!inView) {
    stopArchTour();
    return;
  }
  if (entered) {
    archAutoplay = !reduceMotion;
    setArchStep(0);
  }
  scheduleArchTour();
  syncArchTourStatus();
}

for (const button of buttons) {
  button.addEventListener("click", () => call(button.dataset.action));
}

for (const button of archStepBtns) {
  button.addEventListener("click", () => {
    setArchAutoplay(false);
    setArchStep(Number(button.dataset.step));
  });
  button.addEventListener("keydown", (event) => {
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (archIndex + 1) % ARCH_STEPS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (archIndex - 1 + ARCH_STEPS.length) % ARCH_STEPS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = ARCH_STEPS.length - 1;
    }
    if (next === null) return;
    event.preventDefault();
    setArchAutoplay(false);
    setArchStep(next);
    archStepBtns[next].focus();
  });
}

archReplayButton.addEventListener("click", replayArchTour);

archFigure.addEventListener("mouseenter", () =>
  setArchPaused("hover", true)
);
archFigure.addEventListener("mouseleave", () =>
  setArchPaused("hover", false)
);
archFigure.addEventListener("focusin", () => setArchPaused("focus", true));
archFigure.addEventListener("focusout", (event) => {
  if (!archFigure.contains(event.relatedTarget)) {
    setArchPaused("focus", false);
  }
});

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    () => onArchVisibility(measureArchInView()),
    { threshold: [0, 0.1, 0.2, 0.35] }
  );
  observer.observe(archSection);
} else {
  window.addEventListener(
    "scroll",
    () => onArchVisibility(measureArchInView()),
    { passive: true }
  );
}

setArchStep(0);
setPhase("ready");
call("status");
