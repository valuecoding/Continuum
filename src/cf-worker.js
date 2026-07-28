import { configureDb, query, withRequestClient } from "./db/client.js";
import { normalizeSessionId } from "./http/session.js";
import {
  getSession,
  listTasks,
  recall,
} from "./memory/store.js";
import { resumeMission, startMission } from "./agent/runtime.js";

const API_PATHS = new Set([
  "/api/crash",
  "/api/full",
  "/api/resume",
  "/api/status",
]);
const MUTATING_API_PATHS = new Set([
  "/api/crash",
  "/api/full",
  "/api/resume",
]);

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

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function isExplicitCrossSiteRequest(request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return (
    (origin && origin !== requestUrl.origin) ||
    fetchSite === "cross-site"
  );
}

export async function enforceApiRateLimit(request, env, pathname) {
  const mutation = MUTATING_API_PATHS.has(pathname);
  const limiter = mutation
    ? env.DEMO_MUTATION_LIMITER
    : env.DEMO_READ_LIMITER;
  if (!limiter?.limit) return null;

  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const scope = mutation ? "mutation" : "read";

  try {
    const { success } = await limiter.limit({
      key: `${scope}:${clientIp}`,
    });
    if (success) return null;
    return json(
      { error: "Too many demo requests. Try again in a minute." },
      429,
      { "Retry-After": "60" }
    );
  } catch (error) {
    console.error("Continuum rate limiter unavailable", error?.name || "Error");
    return json(
      { error: "The demo is temporarily unavailable. Try again shortly." },
      503,
      { "Retry-After": "10" }
    );
  }
}

function internalApiError(error, pathname) {
  const requestId = crypto.randomUUID();
  console.error(
    `Continuum API failure [${requestId}] ${pathname}`,
    error?.name || "Error"
  );
  return json(
    {
      error: "The demo request failed. Try again.",
      requestId,
    },
    500
  );
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
  const { pathname } = new URL(request.url);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!API_PATHS.has(pathname)) {
    return json({ error: "Not found" }, 404);
  }
  if (isExplicitCrossSiteRequest(request)) {
    return json({ error: "Cross-site API requests are not allowed" }, 403);
  }

  const rawSessionId = request.headers.get("X-Continuum-Session");
  const requestedSessionId = normalizeSessionId(rawSessionId);
  if (rawSessionId && !requestedSessionId) {
    return json({ error: "Invalid Continuum session id" }, 400);
  }

  const rateLimited = await enforceApiRateLimit(request, env, pathname);
  if (rateLimited) return rateLimited;

  applyEnv(env);
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
              log: `Invocation A stopped after committed step 2 · ${err.sessionId}\nCursor and vector memory persisted in CockroachDB. Resume starts a fresh request.`,
            });
          }
          throw err;
        }
      }

      if (pathname === "/api/resume") {
        if (!requestedSessionId) {
          return json(
            { error: "No client-scoped crashed session to resume" },
            400
          );
        }
        const existing = await getSession(requestedSessionId);
        if (!existing) {
          return json({ error: "Continuum session not found" }, 404);
        }
        if (!["crashed", "paused"].includes(existing.status)) {
          return json(
            { error: `Session cannot resume from status ${existing.status}` },
            409
          );
        }
        let done;
        try {
          done = await resumeMission(existing.id);
        } catch (error) {
          if (error?.code === "CONTINUUM_RESUME_CONFLICT") {
            return json(
              { error: "This mission is already being resumed" },
              409
            );
          }
          throw error;
        }
        const snap = await buildSnapshot(done);
        return json({
          ...snap,
          log: `Invocation B loaded ${done.id} from CockroachDB → ${done.status}`,
        });
      }

      if (pathname === "/api/status") {
        const session = requestedSessionId
          ? await getSession(requestedSessionId)
          : null;
        const snap = await buildSnapshot(session);
        return json({
          ...snap,
          log: snap.session
            ? `Client session ${snap.session.id} · ${snap.session.status}`
            : "No mission in this browser yet. Run the crash proof to begin.",
        });
      }

    } catch (err) {
      return internalApiError(err, pathname);
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
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; upgrade-insecure-requests"
  );

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
