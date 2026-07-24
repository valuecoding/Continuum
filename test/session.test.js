import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSessionId } from "../src/http/session.js";

test("normalizeSessionId accepts canonical UUIDs", () => {
  assert.equal(
    normalizeSessionId("11111111-1111-4111-8111-111111111111"),
    "11111111-1111-4111-8111-111111111111"
  );
});

test("normalizeSessionId normalizes case and surrounding whitespace", () => {
  assert.equal(
    normalizeSessionId("  AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA  "),
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  );
});

test("normalizeSessionId rejects absent and malformed identifiers", () => {
  assert.equal(normalizeSessionId(null), null);
  assert.equal(normalizeSessionId("latest"), null);
  assert.equal(normalizeSessionId("../another-session"), null);
  assert.equal(normalizeSessionId("11111111-1111-0111-8111-111111111111"), null);
});

test("normalizeSessionId handles Node's array header shape", () => {
  assert.equal(
    normalizeSessionId(["11111111-1111-4111-8111-111111111111"]),
    "11111111-1111-4111-8111-111111111111"
  );
});
