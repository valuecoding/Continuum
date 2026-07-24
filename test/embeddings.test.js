import assert from "node:assert/strict";
import test from "node:test";
import { DIM, localEmbed } from "../src/memory/embeddings.js";

test("local fallback produces deterministic normalized vectors", () => {
  const first = localEmbed("durable agent memory");
  const second = localEmbed("durable agent memory");
  const norm = Math.sqrt(first.reduce((sum, value) => sum + value ** 2, 0));

  assert.equal(first.length, DIM);
  assert.deepEqual(first, second);
  assert.ok(Math.abs(norm - 1) < 1e-10);
});

test("local fallback differentiates different memory text", () => {
  assert.notDeepEqual(
    localEmbed("recover the incident"),
    localEmbed("schedule a meeting")
  );
});
