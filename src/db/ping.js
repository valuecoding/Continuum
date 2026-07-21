import "dotenv/config";
import { closePool, query } from "./client.js";

async function ping() {
  const { rows } = await query(
    `SELECT current_database() AS db, current_user AS user, version() AS version`
  );
  console.log(rows[0]);
  console.log("CockroachDB connection OK.");
}

ping()
  .catch((err) => {
    console.error("Ping failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
