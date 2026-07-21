import "dotenv/config";
import fs from "node:fs";
import pg from "pg";

const { Pool } = pg;

function sslOptions() {
  const certPath =
    process.env.COCKROACH_SSL_ROOT_CERT || process.env.PGSSLROOTCERT;
  if (certPath && fs.existsSync(certPath)) {
    return {
      rejectUnauthorized: true,
      ca: fs.readFileSync(certPath).toString(),
    };
  }
  // Still require TLS; cluster uses verify-full when cert is present
  return { rejectUnauthorized: false };
}

function buildConfig() {
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

let pool;

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
  return getPool().query(text, params);
}

export async function withClient(fn) {
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
