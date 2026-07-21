import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "./db/client.js";
import {
  getSession,
  latestRunningSession,
  listTasks,
  recall,
} from "./memory/store.js";
import { resumeMission, startMission } from "./agent/runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function buildSnapshot(sessionOverride = null) {
  const { rows: counts } = await query(`
    SELECT
      (SELECT count(*)::int FROM agent_sessions) AS sessions,
      (SELECT count(*)::int FROM agent_tasks) AS tasks,
      (SELECT count(*)::int FROM agent_memories) AS memories,
      (SELECT count(*)::int FROM agent_events) AS events
  `);

  let session = sessionOverride;
  if (!session) session = await latestRunningSession();
  if (!session) {
    const { rows } = await query(
      `SELECT * FROM agent_sessions ORDER BY updated_at DESC LIMIT 1`
    );
    session = rows[0] || null;
  }

  const tasks = session ? await listTasks(session.id) : [];
  const memories = await recall("recovery outage agent durable memory", {
    scope: "ops",
    limit: 5,
  });

  return {
    counts: counts[0],
    session,
    tasks,
    memories,
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safe);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404).end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET") {
        serveStatic(req, res);
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405).end("Method not allowed");
        return;
      }

      if (req.url === "/api/full") {
        const session = await startMission({
          title: "UI full mission",
          stepDelayMs: 120,
        });
        const snap = await buildSnapshot(session);
        sendJson(res, 200, {
          ...snap,
          log: `Full mission completed · ${session.id}`,
        });
        return;
      }

      if (req.url === "/api/crash") {
        try {
          await startMission({
            title: "UI crash-resume proof",
            crashAfterStep: 2,
            stepDelayMs: 120,
          });
          sendJson(res, 500, { error: "Expected crash did not occur" });
        } catch (err) {
          if (err.code === "CONTINUUM_SIMULATED_CRASH") {
            const session = await getSession(err.sessionId);
            const snap = await buildSnapshot(session);
            sendJson(res, 200, {
              ...snap,
              log: `Simulated crash after step 2 · session ${err.sessionId}\nMemory persisted in CockroachDB. Press Resume.`,
            });
            return;
          }
          throw err;
        }
        return;
      }

      if (req.url === "/api/resume") {
        const existing = await latestRunningSession();
        if (!existing) {
          sendJson(res, 404, { error: "No crashed/running session to resume" });
          return;
        }
        const done = await resumeMission(existing.id);
        const snap = await buildSnapshot(done);
        sendJson(res, 200, {
          ...snap,
          log: `Resumed ${done.id} → ${done.status}`,
        });
        return;
      }

      if (req.url === "/api/status") {
        const snap = await buildSnapshot();
        sendJson(res, 200, {
          ...snap,
          log: snap.session
            ? `Showing ${snap.session.status} session ${snap.session.id}`
            : "No sessions yet. Crash after step 2 to begin the proof.",
        });
        return;
      }

      res.writeHead(404).end("Not found");
    } catch (err) {
      sendJson(res, 500, { error: String(err.message || err) });
    }
  });
}

export async function startServer({ port = 0 } = {}) {
  const server = createServer();
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  return { server, url, port: address.port };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const listenPort = Number(process.env.PORT || 8787);
  const { url } = await startServer({ port: listenPort });
  console.log(`Continuum demo UI → ${url}`);
  process.on("SIGINT", async () => {
    await closePool();
    process.exit(0);
  });
}
