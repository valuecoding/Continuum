import "dotenv/config";
import { closePool } from "../db/client.js";
import {
  listTasks,
  latestRunningSession,
  recall,
} from "../memory/store.js";
import { resumeMission, startMission } from "../agent/runtime.js";

function hasFlag(name) {
  return process.argv.includes(name);
}

async function printStatus(sessionId) {
  const tasks = await listTasks(sessionId);
  console.log("\nTask cursor (from CockroachDB):");
  for (const t of tasks) {
    console.log(
      `  [${t.status.padEnd(11)}] step ${t.step_index}: ${t.goal}`
    );
  }
  const memories = await recall("agent recovery outage", {
    scope: "ops",
    limit: 3,
  });
  console.log("\nSemantic recall:");
  for (const m of memories) {
    const dist =
      m.distance === undefined ? "" : ` (distance=${Number(m.distance).toFixed(4)})`;
    console.log(`  - ${m.content}${dist}`);
  }
}

async function main() {
  const crashMidway = hasFlag("--crash-midway");
  const resumeOnly = hasFlag("--resume");

  if (resumeOnly) {
    const existing = await latestRunningSession();
    if (!existing) {
      console.error("No running/crashed session to resume.");
      process.exitCode = 1;
      return;
    }
    console.log(`Resuming session ${existing.id} (status=${existing.status})`);
    await printStatus(existing.id);
    const done = await resumeMission(existing.id);
    console.log(`\nResumed → status=${done.status}`);
    await printStatus(done.id);
    return;
  }

  if (crashMidway) {
    console.log("Starting mission, will simulate crash after step 2…");
    try {
      await startMission({
        title: "Continuum jury crash-resume proof",
        crashAfterStep: 2,
        stepDelayMs: 250,
      });
      console.error("Expected a simulated crash, but mission completed.");
      process.exitCode = 1;
    } catch (err) {
      if (err.code === "CONTINUUM_SIMULATED_CRASH") {
        console.log(`\n💥 ${err.message}`);
        console.log(`Session ${err.sessionId} persisted as crashed.`);
        console.log("Memory is in CockroachDB. Re-run with --resume.");
        await printStatus(err.sessionId);
        return;
      }
      throw err;
    }
    return;
  }

  console.log("Starting full mission (no crash)…");
  const session = await startMission({
    title: "Continuum happy-path mission",
    stepDelayMs: 200,
  });
  console.log(`\nCompleted session ${session.id} status=${session.status}`);
  await printStatus(session.id);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
