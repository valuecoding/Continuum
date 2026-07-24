import assert from "node:assert/strict";
import test from "node:test";
import { startServer } from "../src/server.js";

test("API rejects ambiguous and malformed recovery targets before DB access", async (context) => {
  const { server, url } = await startServer({ port: 0 });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const missing = await fetch(`${url}/api/resume`, { method: "POST" });
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), {
    error: "No client-scoped crashed session to resume",
  });

  const malformed = await fetch(`${url}/api/status`, {
    method: "POST",
    headers: { "X-Continuum-Session": "latest" },
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    error: "Invalid Continuum session id",
  });
});
