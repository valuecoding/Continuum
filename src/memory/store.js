import { query } from "../db/client.js";
import { embedText } from "./embeddings.js";

export async function createSession(title) {
  const { rows } = await query(
    `INSERT INTO agent_sessions (title, status)
     VALUES ($1, 'running')
     RETURNING *`,
    [title]
  );
  return rows[0];
}

export async function getSession(sessionId) {
  const { rows } = await query(`SELECT * FROM agent_sessions WHERE id = $1`, [
    sessionId,
  ]);
  return rows[0] || null;
}

export async function setSessionStatus(sessionId, status) {
  const { rows } = await query(
    `UPDATE agent_sessions
     SET status = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [sessionId, status]
  );
  return rows[0];
}

export async function addTask(sessionId, stepIndex, goal, payload = {}) {
  const { rows } = await query(
    `INSERT INTO agent_tasks (session_id, step_index, goal, payload, status)
     VALUES ($1, $2, $3, $4::JSONB, 'pending')
     RETURNING *`,
    [sessionId, stepIndex, goal, JSON.stringify(payload)]
  );
  return rows[0];
}

export async function listTasks(sessionId) {
  const { rows } = await query(
    `SELECT * FROM agent_tasks
     WHERE session_id = $1
     ORDER BY step_index ASC`,
    [sessionId]
  );
  return rows;
}

export async function markTask(taskId, status, { result, error } = {}) {
  const { rows } = await query(
    `UPDATE agent_tasks
     SET status = $2,
         result = COALESCE($3::JSONB, result),
         error = $4,
         started_at = CASE
           WHEN $2 = 'in_progress' AND started_at IS NULL THEN now()
           ELSE started_at
         END,
         finished_at = CASE
           WHEN $2 IN ('completed', 'failed', 'skipped') THEN now()
           ELSE finished_at
         END
     WHERE id = $1
     RETURNING *`,
    [
      taskId,
      status,
      result === undefined ? null : JSON.stringify(result),
      error ?? null,
    ]
  );
  return rows[0];
}

export async function logEvent(sessionId, kind, message, data = {}, taskId = null) {
  const { rows } = await query(
    `INSERT INTO agent_events (session_id, task_id, kind, message, data)
     VALUES ($1, $2, $3, $4, $5::JSONB)
     RETURNING *`,
    [sessionId, taskId, kind, message, JSON.stringify(data)]
  );
  return rows[0];
}

export async function remember({
  content,
  scope = "global",
  kind = "note",
  sessionId = null,
  metadata = {},
}) {
  const { literal, provider } = await embedText(content);
  const { rows } = await query(
    `INSERT INTO agent_memories (session_id, scope, kind, content, metadata, embedding)
     VALUES ($1, $2, $3, $4, $5::JSONB, $6::VECTOR)
     RETURNING id, scope, kind, content, created_at`,
    [
      sessionId,
      scope,
      kind,
      content,
      JSON.stringify({ ...metadata, embed_provider: provider }),
      literal,
    ]
  );
  return rows[0];
}

export async function recall(queryText, { scope = "global", limit = 5 } = {}) {
  const { literal } = await embedText(queryText);
  try {
    const { rows } = await query(
      `SELECT id, scope, kind, content, metadata, created_at,
              embedding <-> $1::VECTOR AS distance
       FROM agent_memories
       WHERE scope = $2
       ORDER BY embedding <-> $1::VECTOR
       LIMIT $3`,
      [literal, scope, limit]
    );
    return rows;
  } catch {
    // Fallback without vector ops
    const { rows } = await query(
      `SELECT id, scope, kind, content, metadata, created_at
       FROM agent_memories
       WHERE scope = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [scope, limit]
    );
    return rows;
  }
}

export async function latestRunningSession() {
  const { rows } = await query(
    `SELECT * FROM agent_sessions
     WHERE status IN ('running', 'crashed', 'paused')
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  return rows[0] || null;
}
