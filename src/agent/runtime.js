import {
  addTask,
  createSession,
  getSession,
  listTasks,
  logEvent,
  markTask,
  recall,
  remember,
  setSessionStatus,
} from "../memory/store.js";

const DEFAULT_STEPS = [
  {
    goal: "Acknowledge the incident and load durable context",
    run: async (ctx) => {
      const memories = await recall("production outage agent recovery", {
        scope: ctx.scope,
        limit: 3,
      });
      return {
        remembered: memories.map((m) => m.content),
        note: "Context loaded from CockroachDB memory",
      };
    },
  },
  {
    goal: "Diagnose likely failure mode from prior memories",
    run: async (ctx) => {
      await sleep(ctx.stepDelayMs);
      const diagnosis =
        "Agent process interrupted mid-workflow; durable task cursor required";
      await remember({
        sessionId: ctx.sessionId,
        scope: ctx.scope,
        kind: "decision",
        content: diagnosis,
        metadata: { step: 2 },
      });
      return { diagnosis };
    },
  },
  {
    goal: "Apply remediation checklist",
    run: async (ctx) => {
      await sleep(ctx.stepDelayMs);
      const actions = [
        "Mark interrupted step failed-open",
        "Resume from last incomplete task_index",
        "Write recovery event to agent_events",
      ];
      return { actions };
    },
  },
  {
    goal: "Verify recovery and persist closing memory",
    run: async (ctx) => {
      await sleep(ctx.stepDelayMs);
      const summary =
        "Continuum recovered the workflow from CockroachDB without human re-briefing";
      await remember({
        sessionId: ctx.sessionId,
        scope: ctx.scope,
        kind: "incident",
        content: summary,
        metadata: { step: 4 },
      });
      return { summary, ok: true };
    },
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startMission({
  title = "Continuum crash-resume mission",
  scope = "ops",
  steps = DEFAULT_STEPS,
  stepDelayMs = 400,
  crashAfterStep,
} = {}) {
  const session = await createSession(title);
  await remember({
    sessionId: session.id,
    scope,
    kind: "note",
    content:
      "Production agents must survive process death; Continuum stores task state and embeddings in CockroachDB.",
  });

  for (let i = 0; i < steps.length; i++) {
    await addTask(session.id, i + 1, steps[i].goal);
  }

  await logEvent(session.id, "mission_started", "Mission created", {
    steps: steps.length,
  });

  return runMission(session.id, { scope, steps, stepDelayMs, crashAfterStep });
}

export async function runMission(
  sessionId,
  { scope = "ops", steps = DEFAULT_STEPS, stepDelayMs = 400, crashAfterStep } = {}
) {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  await setSessionStatus(sessionId, "running");
  const tasks = await listTasks(sessionId);

  for (const task of tasks) {
    if (task.status === "completed" || task.status === "skipped") continue;

    await markTask(task.id, "in_progress");
    await logEvent(sessionId, "step_started", task.goal, {}, task.id);

    const step = steps[task.step_index - 1];
    if (!step) {
      await markTask(task.id, "failed", { error: "Missing step definition" });
      continue;
    }

    try {
      const result = await step.run({
        sessionId,
        scope,
        stepDelayMs,
        task,
      });
      await markTask(task.id, "completed", { result });
      await logEvent(
        sessionId,
        "step_completed",
        `Completed: ${task.goal}`,
        result,
        task.id
      );
    } catch (err) {
      await markTask(task.id, "failed", { error: err.message });
      await logEvent(
        sessionId,
        "step_failed",
        err.message,
        {},
        task.id
      );
      await setSessionStatus(sessionId, "failed");
      throw err;
    }

    if (
      crashAfterStep != null &&
      Number(crashAfterStep) === Number(task.step_index)
    ) {
      await setSessionStatus(sessionId, "crashed");
      await logEvent(
        sessionId,
        "simulated_crash",
        `Simulated crash after step ${task.step_index}`,
        { task_id: task.id }
      );
      const error = new Error(
        `CONTINUUM_SIMULATED_CRASH after step ${task.step_index}`
      );
      error.code = "CONTINUUM_SIMULATED_CRASH";
      error.sessionId = sessionId;
      throw error;
    }
  }

  await setSessionStatus(sessionId, "completed");
  await logEvent(sessionId, "mission_completed", "Mission finished");
  return getSession(sessionId);
}

export async function resumeMission(sessionId, opts = {}) {
  await logEvent(sessionId, "mission_resumed", "Resuming from durable memory");
  return runMission(sessionId, opts);
}

export { DEFAULT_STEPS };
