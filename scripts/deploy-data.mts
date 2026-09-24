// One-off copy of the demo's data to the hosted services, reading their credentials from
// .env.deploy (git-ignored, and not a file Next.js loads, so local runs keep using the local
// services; nothing here prints the values):
//   - the `scifact` collection from the local Qdrant to Qdrant Cloud (QDRANT_URL, QDRANT_API_KEY),
//     vectors and payloads as-is, with the same index settings as the local copy;
//   - the demo's session-b chat to MongoDB Atlas (MONGODB_URI) as the read-only `example` chat.
//
//     npx tsx scripts/deploy-data.mts
import { QdrantClient } from "@qdrant/js-client-rest";
import { MongoClient } from "mongodb";

process.loadEnvFile(".env.deploy");
const { QDRANT_URL, QDRANT_API_KEY, MONGODB_URI } = process.env;
if (
  !QDRANT_URL?.startsWith("https://") ||
  !QDRANT_API_KEY ||
  !MONGODB_URI?.startsWith("mongodb+srv://")
) {
  throw new Error(
    ".env.deploy needs QDRANT_URL (https://...), QDRANT_API_KEY and MONGODB_URI (mongodb+srv://...)",
  );
}
const COLLECTION = "scifact";
const DB = "agent_lab_ts";
const EXAMPLE_SOURCE = process.argv[2] ?? "ts-0e0075-b";

// --- Qdrant ---------------------------------------------------------------------------------
const local = new QdrantClient({ url: "http://127.0.0.1:6333" });
const cloud = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
  port: 6333,
});
if (!(await cloud.collectionExists(COLLECTION)).exists) {
  await cloud.createCollection(COLLECTION, {
    vectors: { dense: { size: 384, distance: "Cosine" } },
    sparse_vectors: { bm25: { modifier: "idf" } },
    // In RAM: agent-memory-lab measured on-disk payloads doubling server time.
    on_disk_payload: false,
    // At 5K points Qdrant would otherwise never build the HNSW index (see agent-memory-lab).
    hnsw_config: { m: 16, ef_construct: 100, full_scan_threshold: 10 },
    optimizers_config: { indexing_threshold: 1 },
  });
}
let offset: string | number | undefined | null = undefined;
let copied = 0;
do {
  const page = await local.scroll(COLLECTION, {
    limit: 256,
    offset,
    with_payload: true,
    with_vector: true,
  });
  if (page.points.length) {
    await cloud.upsert(COLLECTION, {
      wait: true,
      points: page.points.map((p) => ({
        id: p.id,
        vector: p.vector as Record<string, never>,
        payload: p.payload ?? {},
      })),
    });
  }
  copied += page.points.length;
  offset = page.next_page_offset as string | number | null | undefined;
  process.stdout.write(`\rqdrant: ${copied} points`);
} while (offset != null);
const { count } = await cloud.count(COLLECTION, { exact: true });
console.log(`\nqdrant cloud: ${count} points in ${COLLECTION}`);

// --- MongoDB --------------------------------------------------------------------------------
const src = await new MongoClient("mongodb://127.0.0.1:27017", {
  ignoreUndefined: true,
}).connect();
const dst = await new MongoClient(MONGODB_URI, {
  ignoreUndefined: true,
}).connect();
const chat = await src
  .db(DB)
  .collection<{ _id: string; messages: unknown[] }>("chats")
  .findOne({ _id: EXAMPLE_SOURCE });
if (!chat) throw new Error(`no local chat ${EXAMPLE_SOURCE}`);
await dst
  .db(DB)
  .collection<{ _id: string }>("chats")
  .replaceOne(
    { _id: "example" },
    { user_id: "example", messages: chat.messages, updated_at: new Date() },
    { upsert: true },
  );
console.log(
  `atlas: example chat saved (${chat.messages.length} messages from ${EXAMPLE_SOURCE})`,
);
await Promise.all([src.close(), dst.close()]);
