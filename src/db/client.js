import fs from "node:fs";
import pg from "pg";

const { Pool, Client } = pg;

/** Optional override for Workers/Hyperdrive (no local CA file). */
let overrideConfig = null;

/** Request-scoped Client for Workers — Hyperdrive pools; never use pg.Pool there. */
let requestClient = null;

/** Local Node pool (CLI / demo server only). */
let pool;

function sslOptions() {
  const certPath =
    process.env.COCKROACH_SSL_ROOT_CERT || process.env.PGSSLROOTCERT;
  if (certPath && fs.existsSync(certPath)) {
    return {
      rejectUnauthorized: true,
      ca: fs.readFileSync(certPath).toString(),
    };
  }
  return { rejectUnauthorized: false };
}

function buildConfig() {
  if (overrideConfig) return overrideConfig;

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: sslOptions(),
    };
  }

  return {
    host: process.env.COCKROACH_HOST,
    port: Number(process.env.COCKROACH_PORT || 26257),
    user: process.env.COCKROACH_USER,
    password: process.env.COCKROACH_PASSWORD,
    database: process.env.COCKROACH_DATABASE || "defaultdb",
    ssl: sslOptions(),
  };
}

/**
 * Point DB config at Hyperdrive (or any connection string) for Workers.
 * Hyperdrive handles TLS to Cockroach; Worker uses the local proxy string.
 */
export function configureDb({ connectionString }) {
  if (!connectionString) return;
  overrideConfig = {
    connectionString,
    ssl: false,
  };
}

/**
 * Run fn with a single pg.Client for this Worker request.
 * Required on Cloudflare Workers — pg.Pool hangs the isolate.
 */
export async function withRequestClient(fn) {
  const cfg = buildConfig();
  const client = new Client({
    ...cfg,
    // One-shot connection; Hyperdrive owns the real pool.
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  requestClient = client;
  try {
    return await fn(client);
  } finally {
    requestClient = null;
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}

export function getPool() {
  if (!pool) {
    pool = new Pool({
      ...buildConfig(),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
  }
  return pool;
}

export async function query(text, params = []) {
  if (requestClient) {
    return requestClient.query(text, params);
  }
  return getPool().query(text, params);
}

export async function withClient(fn) {
  if (requestClient) {
    return fn(requestClient);
  }
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
