import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "../../sql/001_init.sql");

async function migrate() {
  const sql = fs.readFileSync(sqlPath, "utf8");
  console.log("Applying schema…");
  await query(sql);

  // Enable vector feature when supported (Cloud may already allow VECTOR type)
  try {
    await query(`SET CLUSTER SETTING feature.vector_index.enabled = true`);
    console.log("Vector index feature setting requested.");
  } catch (err) {
    console.log(`Vector feature setting skipped: ${err.message}`);
  }

  try {
    await query(`
      CREATE VECTOR INDEX IF NOT EXISTS agent_memories_embedding_idx
      ON agent_memories (scope, embedding)
    `);
    console.log("Vector index created on agent_memories.");
  } catch (err) {
    console.log(`Vector index skipped: ${err.message}`);
  }

  const tables = await query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE 'agent_%'
    ORDER BY table_name
  `);
  console.log("Tables:", tables.rows.map((r) => r.table_name).join(", "));
  console.log("Migration complete.");
}

migrate()
  .catch((err) => {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
