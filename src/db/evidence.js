import "dotenv/config";
import { closePool, query } from "./client.js";

async function collectEvidence() {
  const indexes = await query("SHOW INDEXES FROM agent_memories");
  const vectorColumns = indexes.rows
    .filter((row) => row.index_name === "agent_memories_embedding_idx")
    .map((row) => row.column_name)
    .filter((column) => !["id"].includes(column));
  const providers = await query(`
    SELECT
      COALESCE(metadata->>'embed_provider', 'unknown') AS provider,
      count(*)::int AS memory_rows
    FROM agent_memories
    GROUP BY provider
    ORDER BY provider
  `);

  const vectorIndexReady =
    vectorColumns.includes("scope") && vectorColumns.includes("embedding");
  console.log("Continuum production evidence");
  console.log(
    `- distributed vector index: ${
      vectorIndexReady ? "ready" : "missing"
    } (${vectorColumns.join(", ") || "no indexed columns"})`
  );
  for (const row of providers.rows) {
    console.log(`- ${row.provider} memories: ${Number(row.memory_rows)}`);
  }

  if (!vectorIndexReady) {
    throw new Error("agent_memories_embedding_idx is not ready");
  }
}

collectEvidence()
  .catch((error) => {
    console.error("Evidence check failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
