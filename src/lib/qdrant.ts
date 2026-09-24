// The same one-call hybrid query as agent-memory-lab's qdrant_store.hybrid(): dense and BM25
// prefetches (top 100 each) fused server-side with RRF (k=60), against the collection it built.
//
// Queries go through node:http with a keep-alive agent by default. For a dense query (~8 KB JSON
// body) on this machine, the identical request took ~3 ms p50 via node:http, ~15 ms via
// undici.request and ~60 ms via fetch(), which @qdrant/js-client-rest uses. scripts/parity.mts
// measures all three; the results are in docs/parity.json.
import http from "node:http";
import { QdrantClient } from "@qdrant/js-client-rest";
import { request } from "undici";
import { denseQuery } from "./dense";
import { sparseQuery } from "./bm25";

export const COLLECTION = "scifact";
const HNSW_EF = 128;
const PREFETCH = 100;
const QDRANT_URL = process.env.QDRANT_URL ?? "http://127.0.0.1:6333";

export const qdrant = new QdrantClient({ url: QDRANT_URL });
const agent = new http.Agent({ keepAlive: true });

export type Transport = "node-http" | "undici" | "js-client";
type Sparse = { indices: number[]; values: number[] };
type Point = { id: number | string; payload?: Record<string, unknown> | null };

const QUERY_URL = `${QDRANT_URL}/collections/${COLLECTION}/points/query`;

function post(payload: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      QUERY_URL,
      {
        method: "POST",
        agent,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function query(body: Record<string, unknown>, transport: Transport): Promise<Point[]> {
  if (transport === "js-client") {
    return (await qdrant.query(COLLECTION, body)).points as Point[];
  }
  const payload = JSON.stringify(body);
  let status: number;
  let text: string;
  if (transport === "undici") {
    const res = await request(QUERY_URL, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
    [status, text] = [res.statusCode, await res.body.text()];
  } else {
    ({ status, text } = await post(payload));
  }
  const json = JSON.parse(text) as { result?: { points: Point[] }; status?: unknown };
  if (status !== 200 || !json.result) {
    throw new Error(`qdrant query failed (${status}): ${JSON.stringify(json.status)}`);
  }
  return json.result.points;
}

const ids = (points: Point[]) => points.map((p) => String(p.id));

export async function dense(vector: number[], limit = 100, transport: Transport = "node-http") {
  return ids(await query({ query: vector, using: "dense", limit, params: { hnsw_ef: HNSW_EF }, with_payload: false }, transport));
}

export async function bm25(sparse: Sparse, limit = 100, transport: Transport = "node-http") {
  return ids(await query({ query: sparse, using: "bm25", limit, with_payload: false }, transport));
}

export type Hit = { id: string; title: string; text: string };

export async function hybridVectors(
  dense: number[],
  sparse: Sparse,
  limit: number,
  { withText = false, transport = "node-http" as Transport } = {},
): Promise<Hit[]> {
  const points = await query(
    {
      prefetch: [
        { query: dense, using: "dense", limit: Math.max(limit, PREFETCH), params: { hnsw_ef: HNSW_EF } },
        { query: sparse, using: "bm25", limit: Math.max(limit, PREFETCH) },
      ],
      query: { rrf: { k: 60 } },
      limit,
      with_payload: withText,
    },
    transport,
  );
  return points.map((p) => ({
    id: String(p.id),
    title: String(p.payload?.title ?? ""),
    text: String(p.payload?.text ?? ""),
  }));
}

/** Embed the text both ways and run the hybrid query; what the agent's search tool calls. */
export async function hybrid(text: string, limit = 5): Promise<Hit[]> {
  return hybridVectors(await denseQuery(text), sparseQuery(text), limit, { withText: true });
}
