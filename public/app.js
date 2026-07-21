const timelineEl = document.getElementById("timeline");
const recallEl = document.getElementById("recall");
const logEl = document.getElementById("log");
const sessionMeta = document.getElementById("session-meta");
const phaseBanner = document.getElementById("phase-banner");
const phaseText = document.getElementById("phase-text");
const phaseChip = document.getElementById("phase-chip");
const railChip = document.getElementById("rail-chip");
const railText = document.getElementById("rail-text");
const storyRail = document.getElementById("story-rail");
const demoStage = document.getElementById("demo-stage");
const heroVisual = document.querySelector(".hero-visual");
const hintEl = document.getElementById("hint");
const fxLayer = document.getElementById("fx-layer");
const journeySteps = [...document.querySelectorAll(".journey-step")];
const btnCrash = document.getElementById("btn-crash");
const btnResume = document.getElementById("btn-resume");
const buttons = [...document.querySelectorAll("[data-action]")];
const archSvg = document.getElementById("arch-svg");
const archCaption = document.getElementById("arch-caption");
const archTabs = [...document.querySelectorAll(".arch-tab")];
const archNodes = [...document.querySelectorAll(".arch-node")];

const ARCH_COPY = {
  all: "Continuum writes transactional state and vectors into the same CockroachDB cluster. Bedrock produces embeddings. The managed MCP server lets Cursor inspect the living memory layer.",
  state:
    "Task cursor path: Agent Runtime marks steps in agent_sessions / agent_tasks / agent_events. After a crash, resume reads the last incomplete step_index.",
  vector:
    "Semantic path: Bedrock Titan Embeddings V2 turns notes into VECTOR(1024). CockroachDB stores and searches them with <-> distance.",
  mcp: "Inspect path: CockroachDB managed MCP lets Cursor query the live memory layer without leaving the IDE.",
  runtime:
    "Agent Runtime owns the mission loop — start, simulated crash, and resume — but never keeps the source of truth in process memory.",
  crdb: "CockroachDB is the durable brain: sessions, tasks, events, and VECTOR memories in one transactional store on AWS eu-central-1.",
  bedrock:
    "Amazon Bedrock Titan Text Embeddings V2 turns recovery notes into searchable vectors for semantic recall after restart.",
  mcpNode:
    "Managed MCP bridges Cursor to the CockroachDB Cloud cluster so the jury path is inspectable while the demo runs.",
};

let currentPhase = "ready";

function setBusy(busy) {
  for (const btn of buttons) {
    if (busy) {
      btn.disabled = true;
      continue;
    }
    if (btn === btnResume) {
      btn.disabled = currentPhase !== "crashed" && currentPhase !== "running";
    } else {
      btn.disabled = false;
    }
  }
}

function flashCrash() {
  if (!fxLayer) return;
  fxLayer.classList.remove("is-crash");
  void fxLayer.offsetWidth;
  fxLayer.classList.add("is-crash");
  window.setTimeout(() => fxLayer.classList.remove("is-crash"), 750);
}

function setLive(on) {
  document.body.classList.toggle("is-live", on);
  demoStage?.classList.toggle("is-live", on);
  if (storyRail) storyRail.setAttribute("aria-hidden", on ? "false" : "true");
}

function setPhase(phase, { sessionId, keepLive = false } = {}) {
  currentPhase = phase;
  const short = sessionId ? sessionId.slice(0, 8) : null;
  const live = keepLive || phase !== "ready";

  setLive(live);
  document.body.dataset.phase = phase;
  if (demoStage) demoStage.dataset.phase = phase;
  if (heroVisual) heroVisual.dataset.phase = phase;
  if (storyRail) storyRail.dataset.phase = phase;
  if (phaseChip) phaseChip.textContent = phase;
  if (railChip) railChip.textContent = phase;
  if (phaseBanner) phaseBanner.dataset.phase = phase;

  for (const step of journeySteps) {
    const target = step.dataset.phase;
    step.classList.toggle("is-active", target === phase);
    step.classList.toggle(
      "is-done",
      (phase === "crashed" && target === "ready") ||
        (phase === "completed" &&
          (target === "ready" || target === "crashed")) ||
        (phase === "running" && target === "ready")
    );
  }

  if (phase === "crashed") {
    const msg = short
      ? `Agent crashed after step 2 · session ${short} still lives in CockroachDB.`
      : "Agent crashed mid-mission. Memory is durable — hit Resume.";
    phaseText.textContent = msg;
    if (railText) railText.textContent = "Cut at step 2 · memory durable";
    hintEl.innerHTML =
      "Process is dead. Press <strong>Resume from memory</strong> — the story curve stays pinned above.";
    btnResume.disabled = false;
    btnCrash.classList.remove("is-pulse");
    btnResume.classList.add("is-pulse");
  } else if (phase === "completed") {
    const msg = short
      ? `Mission completed from durable memory · ${short}`
      : "Mission completed from durable memory.";
    phaseText.textContent = msg;
    if (railText) railText.textContent = "Resumed · mission complete";
    hintEl.innerHTML = "Done. Crash again anytime to replay the jury path.";
    btnResume.disabled = true;
    btnResume.classList.remove("is-pulse");
  } else if (phase === "running") {
    phaseText.textContent = "Mission running… writing steps into CockroachDB.";
    if (railText) railText.textContent = "Writing durable steps…";
    hintEl.textContent = "Hang tight — durable writes are in flight.";
    btnResume.disabled = false;
  } else {
    phaseText.textContent = "Waiting for a mission.";
    if (railText) railText.textContent = "Jury path idle";
    hintEl.innerHTML =
      "Start with <strong>Crash after step 2</strong> — the story curve stays with you while CockroachDB holds the cursor.";
    btnResume.disabled = true;
    btnResume.classList.remove("is-pulse");
    if (!keepLive) setLive(false);
  }
}

function taskDetail(task) {
  const result = task.result;
  if (!result || typeof result !== "object") return "";
  if (result.diagnosis) return result.diagnosis;
  if (result.summary) return result.summary;
  if (result.note) return result.note;
  if (Array.isArray(result.actions)) return result.actions.join(" · ");
  if (Array.isArray(result.remembered) && result.remembered.length) {
    return `recalled ${result.remembered.length} memories`;
  }
  return "";
}

function renderStats(counts = {}) {
  document.getElementById("stat-sessions").textContent = counts.sessions ?? "—";
  document.getElementById("stat-tasks").textContent = counts.tasks ?? "—";
  document.getElementById("stat-memories").textContent = counts.memories ?? "—";
  document.getElementById("stat-events").textContent = counts.events ?? "—";
}

function renderTimeline(session, tasks = []) {
  if (!session) {
    sessionMeta.textContent = "idle";
    timelineEl.innerHTML =
      '<li class="empty">Run a mission to populate durable steps.</li>';
    return;
  }

  sessionMeta.textContent = `${session.status} · ${session.id.slice(0, 8)}`;

  const firstPending = tasks.find(
    (t) => t.status === "pending" || t.status === "in_progress"
  );

  timelineEl.innerHTML = tasks
    .map((t) => {
      const detail = taskDetail(t);
      const isBreak =
        session.status === "crashed" &&
        Number(t.step_index) === 2 &&
        t.status === "completed";
      const isNext = firstPending && t.id === firstPending.id;
      const classes = [
        escapeHtml(t.status),
        isBreak ? "is-break" : "",
        isNext ? "is-next" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `
      <li class="${classes}">
        <div class="step">step ${escapeHtml(String(t.step_index))}</div>
        <div>
          <div class="goal">${escapeHtml(t.goal)}</div>
          ${
            detail
              ? `<div class="detail">${escapeHtml(detail)}</div>`
              : ""
          }
          <div class="status">${escapeHtml(t.status)}</div>
        </div>
      </li>`;
    })
    .join("");
}

function renderRecall(memories = []) {
  if (!memories.length) {
    recallEl.innerHTML =
      '<li class="empty">Memories appear here after the agent writes embeddings.</li>';
    return;
  }
  recallEl.innerHTML = memories
    .map((m) => {
      const dist =
        m.distance === undefined || m.distance === null
          ? ""
          : ` · d=${Number(m.distance).toFixed(3)}`;
      const provider = m.metadata?.embed_provider
        ? ` · ${m.metadata.embed_provider}`
        : "";
      return `<li>${escapeHtml(m.content)}${escapeHtml(dist)}${escapeHtml(
        provider
      )}</li>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applyPayload(data, action) {
  if (data.log) logEl.textContent = data.log;
  renderStats(data.counts || {});
  renderTimeline(data.session, data.tasks || []);
  renderRecall(data.memories || []);

  const status = data.session?.status || "ready";
  if (action === "crash" || status === "crashed") {
    setPhase("crashed", { sessionId: data.session?.id });
  } else if (status === "completed") {
    setPhase("completed", { sessionId: data.session?.id });
  } else if (status === "running") {
    setPhase("running", { sessionId: data.session?.id });
  } else if (!data.session) {
    setPhase("ready");
  } else {
    setPhase(status === "paused" ? "running" : "ready", {
      sessionId: data.session?.id,
    });
  }
}

/** Keep write→crash→resume in view: pin story rail, soft-reveal proof — no hard jump. */
function revealLiveComposition() {
  setLive(true);
  const anchor = document.getElementById("cta-anchor");
  if (!anchor) return;
  const top = anchor.getBoundingClientRect().top;
  // Only nudge if CTAs would leave the upper half
  if (top < 72 || top > window.innerHeight * 0.42) {
    anchor.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function call(action) {
  setBusy(true);
  logEl.textContent = `Running ${action}…`;
  if (action === "crash" || action === "resume" || action === "full") {
    setPhase("running", { keepLive: true });
    if (action !== "status") revealLiveComposition();
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(`/api/${action}`, {
      method: "POST",
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    applyPayload(data, action);
    if (action === "crash") {
      flashCrash();
      revealLiveComposition();
    } else if (action === "resume" || action === "full") {
      revealLiveComposition();
    }
  } catch (err) {
    const message =
      err.name === "AbortError"
        ? "Request timed out. Try again."
        : String(err.message || err);
    logEl.textContent = message;
    setBusy(false);
    if (currentPhase === "running") setPhase("ready");
    return;
  } finally {
    window.clearTimeout(timeout);
    setBusy(false);
  }
}

function setArchFlow(flow) {
  if (!archSvg) return;
  archSvg.dataset.flow = flow;
  for (const tab of archTabs) {
    tab.classList.toggle("is-on", tab.dataset.flow === flow);
  }
  for (const node of archNodes) node.classList.remove("is-hot");
  archCaption.textContent = ARCH_COPY[flow] || ARCH_COPY.all;
}

function focusArchNode(nodeName) {
  for (const node of archNodes) {
    node.classList.toggle("is-hot", node.dataset.node === nodeName);
  }
  const map = {
    runtime: "state",
    crdb: "all",
    bedrock: "vector",
    mcp: "mcp",
  };
  const flow = map[nodeName] || "all";
  setArchFlow(flow);
  const copyKey = nodeName === "mcp" ? "mcpNode" : nodeName;
  archCaption.textContent = ARCH_COPY[copyKey] || ARCH_COPY.all;
  const hot = archNodes.find((n) => n.dataset.node === nodeName);
  if (hot) hot.classList.add("is-hot");
}

for (const btn of buttons) {
  btn.addEventListener("click", () => call(btn.dataset.action));
}

for (const tab of archTabs) {
  tab.addEventListener("click", () => setArchFlow(tab.dataset.flow));
}

for (const node of archNodes) {
  node.addEventListener("click", () => focusArchNode(node.dataset.node));
  node.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      focusArchNode(node.dataset.node);
    }
  });
}

setArchFlow("all");
setPhase("ready");
call("status");
