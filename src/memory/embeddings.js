import { createHash } from "node:crypto";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const DIM = 1024;

function toVectorLiteral(values) {
  return `[${values.map((n) => Number(n).toFixed(8)).join(",")}]`;
}

/** Deterministic local embedding when Bedrock is not configured. */
export function localEmbed(text, dimensions = DIM) {
  const vec = new Array(dimensions).fill(0);
  const tokens = String(text).toLowerCase().split(/\W+/).filter(Boolean);
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    for (let i = 0; i < dimensions; i++) {
      const b = digest[i % digest.length];
      vec[i] += (b / 255) * 2 - 1;
    }
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function hasBedrockAuth() {
  return Boolean(
    process.env.AWS_BEARER_TOKEN_BEDROCK ||
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE
  );
}

async function invokeViaBearer(modelId, region, body) {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Bedrock HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

async function invokeViaSdk(modelId, region, body) {
  const client = new BedrockRuntimeClient({ region });
  const res = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: Buffer.from(JSON.stringify(body)),
    })
  );
  return JSON.parse(Buffer.from(res.body).toString("utf8"));
}

export async function embedText(text) {
  const region = process.env.AWS_REGION || "eu-central-1";
  const modelId =
    process.env.BEDROCK_EMBEDDING_MODEL ||
    "amazon.titan-embed-text-v2:0";

  if (!hasBedrockAuth()) {
    const vector = localEmbed(text);
    return {
      vector,
      literal: toVectorLiteral(vector),
      provider: "local",
    };
  }

  const payload = {
    inputText: text,
    dimensions: DIM,
    normalize: true,
  };

  try {
    const parsed = process.env.AWS_BEARER_TOKEN_BEDROCK
      ? await invokeViaBearer(modelId, region, payload)
      : await invokeViaSdk(modelId, region, payload);

    const vector = parsed.embedding;
    if (!Array.isArray(vector)) {
      throw new Error("Bedrock response missing embedding array");
    }
    return {
      vector,
      literal: toVectorLiteral(vector),
      provider: "bedrock",
    };
  } catch (err) {
    console.warn(`Bedrock embed fallback → local: ${err.message}`);
    const vector = localEmbed(text);
    return { vector, literal: toVectorLiteral(vector), provider: "local" };
  }
}

export { DIM, toVectorLiteral };
