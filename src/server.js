import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "./db/client.js";
import { normalizeSessionId } from "./http/session.js";
import {
  getSession,
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
  const session = sessionOverride;
  if (!session) {
    return {
      counts: { tasks: 0, completed: 0, memories: 0, events: 0 },
      session: null,
      tasks: [],
      memories: [],
    };
  }

  const { rows: counts } = await query(
    `SELECT
       (SELECT count(*)::int FROM agent_tasks
        WHERE session_id = $1) AS tasks,
       (SELECT count(*)::int FROM agent_tasks
        WHERE session_id = $1 AND status = 'completed') AS completed,
       (SELECT count(*)::int FROM agent_memories
        WHERE session_id = $1) AS memories,
       (SELECT count(*)::int FROM agent_events
        WHERE session_id = $1) AS events`,
    [session.id]
  );

  const tasks = await listTasks(session.id);
  const memories = await recall("recovery outage agent durable memory", {
    scope: "ops",
    sessionId: session.id,
    limit: 5,
  });
  const numericCounts = Object.fromEntries(
    Object.entries(counts[0]).map(([key, value]) => [key, Number(value)])
  );

  return {
    counts: numericCounts,
    session,
    tasks,
    memories,
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function requestedSession(req) {
  const raw = req.headers["x-continuum-session"];
  return { raw, id: normalizeSessionId(raw) };
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

      const requested = requestedSession(req);
      if (requested.raw && !requested.id) {
        sendJson(res, 400, { error: "Invalid Continuum session id" });
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
              log: `Invocation A stopped after committed step 2 · ${err.sessionId}\nCursor and vector memory persisted in CockroachDB. Resume starts a fresh request.`,
            });
            return;
          }
          throw err;
        }
        return;
      }

      if (req.url === "/api/resume") {
        if (!requested.id) {
          sendJson(res, 400, {
            error: "No client-scoped crashed session to resume",
          });
          return;
        }
        const existing = await getSession(requested.id);
        if (!existing) {
          sendJson(res, 404, { error: "Continuum session not found" });
          return;
        }
        if (!["crashed", "paused"].includes(existing.status)) {
          sendJson(res, 409, {
            error: `Session cannot resume from status ${existing.status}`,
          });
          return;
        }
        let done;
        try {
          done = await resumeMission(existing.id);
        } catch (error) {
          if (error?.code === "CONTINUUM_RESUME_CONFLICT") {
            sendJson(res, 409, {
              error: "This mission is already being resumed",
            });
            return;
          }
          throw error;
        }
        const snap = await buildSnapshot(done);
        sendJson(res, 200, {
          ...snap,
          log: `Invocation B loaded ${done.id} from CockroachDB → ${done.status}`,
        });
        return;
      }

      if (req.url === "/api/status") {
        const session = requested.id ? await getSession(requested.id) : null;
        const snap = await buildSnapshot(session);
        sendJson(res, 200, {
          ...snap,
          log: snap.session
            ? `Client session ${snap.session.id} · ${snap.session.status}`
            : "No mission in this browser yet. Run the crash proof to begin.",
        });
        return;
      }

      res.writeHead(404).end("Not found");
    } catch (err) {
      const requestId = crypto.randomUUID();
      console.error(
        `Continuum API failure [${requestId}]`,
        err?.name || "Error"
      );
      sendJson(res, 500, {
        error: "The demo request failed. Try again.",
        requestId,
      });
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
