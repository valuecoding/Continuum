# Continuum — Devpost submission packet

This copy is ready to paste into Devpost after the replacement demo video has
been uploaded publicly. Keep the technical claims intact; shorten only where a
field has a character limit.

## Submission links

- **Project:** Continuum
- **Tagline:** The runtime stops. The mission continues.
- **Live app:** https://continuum.vortex-digital.de/
- **Source:** https://github.com/valuecoding/Continuum
- **Video:** replace with the new public YouTube or Vimeo URL

## Short description

Continuum is a crash-resilient agent runtime whose task cursor, append-only
event trail, and semantic memory live in CockroachDB Cloud on AWS. Invocation A
stops after two committed steps. A fresh Invocation B receives only the
client-scoped session UUID, reconstructs the mission from CockroachDB, skips
finished work, recalls Bedrock-embedded memory, and continues at step three.

## Inspiration

Production agents do not fail neatly between jobs. They lose compute while
tools are running, tasks are partially complete, and the next action depends on
context that existed only in process memory. Restarting from zero can duplicate
side effects; asking a human to explain the mission again defeats autonomy.
Continuum treats durable memory as part of execution correctness, not as a chat
history feature.

## What it does

The public proof creates a four-step incident-response mission. It writes the
session, ordered tasks, results, events, and semantic memories to CockroachDB,
then deterministically stops Invocation A after step two. The page reads the
persisted cursor and vector memories back from the active, browser-scoped
session. Selecting **Resume invocation B** starts a new HTTP request, loads that
exact mission, skips the two committed tasks, and completes steps three and
four without a human re-brief.

The deterministic stop makes the failure boundary repeatable for judges. The
recovery path is real: no server-side in-memory session object is handed from
Invocation A to Invocation B.

## How we built it

- **CockroachDB Cloud on AWS (`eu-central-1`)** is the system of record for
  sessions, task state, an append-only event trail, and long-term memory.
- **CockroachDB Distributed Vector Indexing** indexes `scope + VECTOR(1024)`;
  semantic recall uses vector distance while operational state and memory stay
  in one database.
- **CockroachDB Cloud Managed MCP Server** gives the development agent a
  read-only inspection plane for the live schema, task cursor, event rows, and
  vector index. It is deliberately separate from the production runtime path.
- **Amazon Bedrock Titan Text Embeddings V2** creates normalized 1024-dimensional
  vectors. Every memory records its embedding provider, and the live proof
  surfaces that evidence.
- A **Cloudflare Worker** serves the public UI and API. Hyperdrive connects the
  Worker to the CockroachDB cluster hosted on AWS.

The runtime and UI are plain JavaScript on Node.js 22. The browser keeps only an
unguessable session UUID in session storage. All authoritative state comes back
from CockroachDB.

## Challenges we ran into

The hardest design problem was proving a real recovery boundary without making
the demo unreliable. A fake timeline would be easy but meaningless. Continuum
instead commits each completed task before a deterministic runtime stop and
starts recovery in a separate request.

Another challenge was representing Managed MCP honestly. MCP is used by the
developer agent to inspect the live cluster; it is not part of the application's
runtime traffic. The architecture diagram separates the solid production data
path from the dashed read-only inspection plane.

The public demo also needed multi-visitor isolation. Earlier approaches that
loaded the "latest" crashed mission could let one browser resume another
visitor's work. Continuum now requires the exact UUID created by that browser,
validates it before database access, and atomically claims a crashed session so
two recovery requests cannot replay the same pending work.

## Accomplishments

- A repeatable crash-and-resume proof backed by live CockroachDB reads.
- Transactional task state and 1024-dimensional semantic memory in one system
  of record.
- A visible distributed vector index on `scope + embedding`.
- Provider evidence showing that production memories were embedded by Bedrock.
- Client-scoped recovery and an atomic single-invocation resume claim.
- A hardened public edge with same-origin API enforcement, separate read/write
  rate limits, generic public errors, HSTS, CSP, anti-framing headers, and no
  committed secrets.
- Automated unit, boundary, security, desktop, and mobile browser tests.

## What we learned

Agent memory is not useful merely because it survives. It must be coupled to a
durable execution cursor, scoped to the correct mission, inspectable after a
failure, and safe to act on exactly once. We also learned that architecture
diagrams should distinguish developer tooling from runtime dependencies; that
separation makes both the security model and the product claim clearer.

## What's next

- Add expiring recovery leases so a second crash during Invocation B can be
  reclaimed safely after a timeout.
- Add retention policies for synthetic public-demo sessions.
- Generalize the four-step proof into a reusable durable workflow SDK.
- Add idempotency keys and compensation metadata for real external tool calls.
- Exercise regional failover with a multi-region CockroachDB deployment.

## CockroachDB tool feedback

Distributed Vector Indexing is most valuable here because vector memory stays
transactionally adjacent to the task cursor and event trail; there is no
separate vector database to reconcile after a failure. Managed MCP made live
inspection fast and safe, but the submission experience would benefit from an
exportable, redacted audit summary that teams could attach as integration
evidence without exposing cluster identifiers.

## Final submission checklist

- Join the hackathon on Devpost before submitting.
- Upload the replacement video publicly to YouTube or Vimeo.
- Confirm the final video is less than three minutes and shows the memory layer
  before and after recovery.
- Replace the video URL in this file, `README.md`, and the site footer.
- Use the live app and repository links above.
- Select **Distributed Vector Indexing** and **Cloud Managed MCP Server** as the
  two CockroachDB tools.
- Select **Amazon Bedrock** as the AWS service.
- Include the architecture image from `docs/images/architecture.png`.
- Submit before August 18, 2026 at 5:00 PM EDT.

## Video upload metadata

**Title**

> Continuum — Crash-resilient agentic memory | CockroachDB × AWS Hackathon

**Description**

> Continuum makes agent recovery visible. Invocation A stops after two
> committed steps. A fresh Invocation B reconstructs the mission from
> CockroachDB Cloud on AWS, recalls Amazon Bedrock-embedded memory, skips
> finished work, and continues at step three.
>
> Live demo: https://continuum.vortex-digital.de/
>
> Source: https://github.com/valuecoding/Continuum
>
> Built with CockroachDB Distributed Vector Indexing, CockroachDB Cloud Managed
> MCP Server, and Amazon Bedrock Titan Text Embeddings V2.
>
> Narration was generated with an AI voice. The application, database reads,
> crash boundary, and recovery shown in the video are real.

**Upload files**

- Video: `artifacts/video/Continuum-hackathon-demo.mp4`
- Captions: `artifacts/video/captions.srt`
- Thumbnail: `artifacts/video/youtube-thumbnail.png`
