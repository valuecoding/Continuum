const timelineEl = document.getElementById("timeline");
const recallEl = document.getElementById("recall");
const logEl = document.getElementById("log");
const sessionMeta = document.getElementById("session-meta");
const buttons = [...document.querySelectorAll("[data-action]")];

function setBusy(busy) {
  for (const btn of buttons) btn.disabled = busy;
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
  timelineEl.innerHTML = tasks
    .map(
      (t) => `
      <li class="${escapeHtml(t.status)}">
        <div class="step">step ${escapeHtml(String(t.step_index))}</div>
        <div>
          <div class="goal">${escapeHtml(t.goal)}</div>
          <div class="status">${escapeHtml(t.status)}</div>
        </div>
      </li>`
    )
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
      return `<li>${escapeHtml(m.content)}${escapeHtml(dist)}</li>`;
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

function applyPayload(data) {
  if (data.log) logEl.textContent = data.log;
  renderStats(data.counts || {});
  renderTimeline(data.session, data.tasks || []);
  renderRecall(data.memories || []);
}

async function call(action) {
  setBusy(true);
  logEl.textContent = `Running ${action}…`;
  try {
    const res = await fetch(`/api/${action}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    applyPayload(data);
  } catch (err) {
    logEl.textContent = String(err.message || err);
  } finally {
    setBusy(false);
  }
}

for (const btn of buttons) {
  btn.addEventListener("click", () => call(btn.dataset.action));
}

call("status");
