import assert from "node:assert/strict";
import test from "node:test";
import {
  enforceApiRateLimit,
  isExplicitCrossSiteRequest,
} from "../src/cf-worker.js";

const ORIGIN = "https://continuum.vortex-digital.de";

test("API rejects explicit cross-site browser requests", () => {
  const sameOrigin = new Request(`${ORIGIN}/api/status`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
    },
  });
  const crossSite = new Request(`${ORIGIN}/api/status`, {
    method: "POST",
    headers: {
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    },
  });
  const serverToServer = new Request(`${ORIGIN}/api/status`, {
    method: "POST",
  });

  assert.equal(isExplicitCrossSiteRequest(sameOrigin), false);
  assert.equal(isExplicitCrossSiteRequest(crossSite), true);
  assert.equal(isExplicitCrossSiteRequest(serverToServer), false);
});

test("mutation rate limit uses the Cloudflare client address", async () => {
  let receivedKey = null;
  const request = new Request(`${ORIGIN}/api/crash`, {
    method: "POST",
    headers: { "CF-Connecting-IP": "203.0.113.42" },
  });
  const env = {
    DEMO_MUTATION_LIMITER: {
      async limit({ key }) {
        receivedKey = key;
        return { success: false };
      },
    },
  };

  const response = await enforceApiRateLimit(
    request,
    env,
    "/api/crash"
  );
  const body = await response.json();

  assert.equal(receivedKey, "mutation:203.0.113.42");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.match(body.error, /too many demo requests/i);
  assert.doesNotMatch(JSON.stringify(body), /203\.0\.113\.42/);
});

test("rate limiter failure is generic and fails closed", async () => {
  const request = new Request(`${ORIGIN}/api/status`, {
    method: "POST",
  });
  const env = {
    DEMO_READ_LIMITER: {
      async limit() {
        throw new Error("internal binding detail");
      },
    },
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  let response;
  try {
    response = await enforceApiRateLimit(request, env, "/api/status");
  } finally {
    console.error = originalConsoleError;
  }
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "10");
  assert.doesNotMatch(JSON.stringify(body), /internal binding detail/);
});
