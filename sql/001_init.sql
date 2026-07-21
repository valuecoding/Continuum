-- Continuum: durable agentic memory on CockroachDB
-- Requires: vector indexes enabled on the cluster when available

CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title STRING NOT NULL,
  status STRING NOT NULL DEFAULT 'running',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('running', 'paused', 'completed', 'failed', 'crashed'))
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  step_index INT NOT NULL,
  goal STRING NOT NULL,
  status STRING NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  result JSONB,
  error STRING,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, step_index),
  CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS agent_tasks_session_idx ON agent_tasks (session_id, step_index);

CREATE TABLE IF NOT EXISTS agent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  task_id UUID REFERENCES agent_tasks(id) ON DELETE SET NULL,
  kind STRING NOT NULL,
  message STRING NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_events_session_idx ON agent_events (session_id, created_at);

-- Long-term semantic memory (embeddings live next to transactional state)
CREATE TABLE IF NOT EXISTS agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  scope STRING NOT NULL DEFAULT 'global',
  kind STRING NOT NULL DEFAULT 'note',
  content STRING NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind IN ('note', 'decision', 'incident', 'preference', 'tool_result'))
);

CREATE INDEX IF NOT EXISTS agent_memories_scope_idx ON agent_memories (scope, created_at DESC);

-- Vector index for ANN search (prefix by scope for filtered recall)
-- If your cluster build does not support VECTOR INDEX yet, migrate.js will skip this safely.
-- CREATE VECTOR INDEX IF NOT EXISTS agent_memories_embedding_idx ON agent_memories (scope, embedding);
