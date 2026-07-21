import { configureDb, query, withRequestClient } from "./db/client.js";
import {
  getSession,
  latestRunningSession,
  listTasks,
  recall,
} from "./memory/store.js";
import { resumeMission, startMission } from "./agent/runtime.js";

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function applyEnv(env) {
  if (env.HYPERDRIVE?.connectionString) {
    configureDb({ connectionString: env.HYPERDRIVE.connectionString });
  } else if (env.DATABASE_URL) {
    configureDb({ connectionString: env.DATABASE_URL });
  }

  if (env.AWS_BEARER_TOKEN_BEDROCK) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = env.AWS_BEARER_TOKEN_BEDROCK;
  }
  if (env.AWS_REGION) process.env.AWS_REGION = env.AWS_REGION;
  if (env.BEDROCK_EMBEDDING_MODEL) {
    process.env.BEDROCK_EMBEDDING_MODEL = env.BEDROCK_EMBEDDING_MODEL;
  }
}

async function handleApi(request, env) {
  applyEnv(env);
  const { pathname } = new URL(request.url);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  return withRequestClient(async () => {
    try {
      if (pathname === "/api/full") {
        const session = await startMission({
          title: "UI full mission",
          stepDelayMs: 120,
        });
        const snap = await buildSnapshot(session);
        return json({
          ...snap,
          log: `Full mission completed · ${session.id}`,
        });
      }

      if (pathname === "/api/crash") {
        try {
          await startMission({
            title: "UI crash-resume proof",
            crashAfterStep: 2,
            stepDelayMs: 120,
          });
          return json({ error: "Expected crash did not occur" }, 500);
        } catch (err) {
          if (err.code === "CONTINUUM_SIMULATED_CRASH") {
            const session = await getSession(err.sessionId);
            const snap = await buildSnapshot(session);
            return json({
              ...snap,
              log: `Simulated crash after step 2 · session ${err.sessionId}\nMemory persisted in CockroachDB. Press Resume.`,
            });
          }
          throw err;
        }
      }

      if (pathname === "/api/resume") {
        const existing = await latestRunningSession();
        if (!existing) {
          return json({ error: "No crashed/running session to resume" }, 404);
        }
        const done = await resumeMission(existing.id);
        const snap = await buildSnapshot(done);
        return json({
          ...snap,
          log: `Resumed ${done.id} → ${done.status}`,
        });
      }

      if (pathname === "/api/status") {
        const snap = await buildSnapshot();
        return json({
          ...snap,
          log: snap.session
            ? `Showing ${snap.session.status} session ${snap.session.id}`
            : "No sessions yet. Crash after step 2 to begin the proof.",
        });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: String(err.message || err) }, 500);
    }
  });
}

function withSecurityHeaders(response, request) {
  const headers = new Headers(response.headers);
  const host = new URL(request.url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  const path = new URL(request.url).pathname;
  const isHtml = path === "/" || path.endsWith(".html");
  if (isHtml) {
    headers.set("Cache-Control", "no-store");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Force HTTPS on the public custom domain (fixes browser "Not secure")
    if (
      url.protocol === "http:" &&
      url.hostname !== "localhost" &&
      url.hostname !== "127.0.0.1"
    ) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname.startsWith("/api/")) {
      return withSecurityHeaders(await handleApi(request, env), request);
    }

    const asset = await env.ASSETS.fetch(request);
    return withSecurityHeaders(asset, request);
  },
};
