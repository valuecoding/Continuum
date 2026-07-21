import "dotenv/config";
import { embedText } from "../memory/embeddings.js";

async function main() {
  console.log("AWS_REGION =", process.env.AWS_REGION || "(default eu-central-1)");
  console.log(
    "Has bearer token =",
    Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK)
  );
  console.log(
    "Has access key =",
    Boolean(process.env.AWS_ACCESS_KEY_ID)
  );
  const result = await embedText(
    "Continuum stores agent memory in CockroachDB and embeds with Bedrock."
  );
  console.log("provider =", result.provider);
  console.log("dimensions =", result.vector.length);
  console.log("sample =", result.vector.slice(0, 5).map((n) => Number(n.toFixed(6))));
  if (result.provider !== "bedrock") {
    console.error(
      "\nStill on local embeddings. Add AWS keys + enable Titan Embeddings V2 in Bedrock."
    );
    process.exitCode = 1;
  } else {
    console.log("\nBedrock embeddings OK.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
