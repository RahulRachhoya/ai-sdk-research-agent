// Checks the TypeScript retrieval path against the Python reference (agent-memory-lab) on the 300
// SciFact test claims: dense-vector agreement, the same nDCG@10 / Recall@100, overlap of the hybrid
// top 10, and Qdrant REST query latency via node:http, undici.request and
// @qdrant/js-client-rest (fetch). Writes docs/parity.json.
//
//     npx tsx scripts/parity.mts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { sparseQuery } from "../src/lib/bm25";
import { denseQuery } from "../src/lib/dense";
import { ndcgAtK, percentile, recallAtK } from "../src/lib/metrics";
import { bm25, dense, hybridVectors, type Transport } from "../src/lib/qdrant";

type Row = {
  id: string;
  text: string;
  qrels: Record<string, number>;
  bm25_ids: number[];
  dense: number[];
  hybrid_top10: string[];
};
const rows: Row[] = JSON.parse(readFileSync("fixtures/scifact-test.json", "utf8"));
const WARMUP = 10;
const round = (x: number, d = 3) => Number(x.toFixed(d));

// 1. Query encoding: TS vectors vs the Python ones, and how long transformers.js takes per query.
await denseQuery("warm up the model");
const vecs: number[][] = [];
const cos: number[] = [];
const embedMs: number[] = [];
let bm25Exact = 0;
for (const r of rows) {
  const t0 = performance.now();
  const v = await denseQuery(r.text);
  embedMs.push(performance.now() - t0);
  vecs.push(v);
  cos.push(v.reduce((s, x, i) => s + x * r.dense[i], 0));
  if (JSON.stringify(sparseQuery(r.text).indices) === JSON.stringify(r.bm25_ids)) bm25Exact++;
}

// 2. Retrieval quality and latency, with the same protocol as bench.py: vectors precomputed,
//    10 warm-up queries, then one sequential timed query per claim.
async function run(fn: (i: number) => Promise<string[]>) {
  for (let i = 0; i < WARMUP; i++) await fn(i);
  const ndcg: number[] = [];
  const recall: number[] = [];
  const lat: number[] = [];
  const ranked: string[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const t0 = performance.now();
    const ids = await fn(i);
    lat.push(performance.now() - t0);
    ranked.push(ids);
    ndcg.push(ndcgAtK(ids, rows[i].qrels, 10));
    recall.push(recallAtK(ids, rows[i].qrels, 100));
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    ranked,
    metrics: {
      "ndcg@10": round(mean(ndcg)),
      "recall@100": round(mean(recall)),
      p50_ms: round(percentile(lat, 50), 1),
      p95_ms: round(percentile(lat, 95), 1),
    },
  };
}

const sparse = rows.map((r) => sparseQuery(r.text));
async function runAll(transport: Transport) {
  return {
    dense: await run((i) => dense(vecs[i], 100, transport)),
    bm25: await run((i) => bm25(sparse[i], 100, transport)),
    hybrid: await run(async (i) => (await hybridVectors(vecs[i], sparse[i], 100, { transport })).map((h) => h.id)),
  };
}
const results = await runAll("node-http");
const viaUndici = await runAll("undici");
const viaClient = await runAll("js-client");
const summary = (r: typeof results) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.metrics]));

let sameTop10 = 0;
let overlap = 0;
results.hybrid.ranked.forEach((ids, i) => {
  const top = ids.slice(0, 10);
  const ref = rows[i].hybrid_top10;
  if (JSON.stringify(top) === JSON.stringify(ref)) sameTop10++;
  overlap += top.filter((d) => ref.includes(d)).length / 10;
});

const report = {
  queries: rows.length,
  bm25_token_ids_identical: bm25Exact,
  dense_cosine_vs_python: { min: round(Math.min(...cos), 6), mean: round(cos.reduce((a, b) => a + b) / cos.length, 6) },
  embed_ms: { p50: round(percentile(embedMs, 50), 1), p95: round(percentile(embedMs, 95), 1) },
  hybrid_top10_identical_order: sameTop10,
  hybrid_top10_mean_overlap: round(overlap / rows.length),
  python_reference: {
    dense: { "ndcg@10": 0.713, "recall@100": 0.942 },
    bm25: { "ndcg@10": 0.683, "recall@100": 0.921 },
    hybrid: { "ndcg@10": 0.725, "recall@100": 0.965 },
  },
  qdrant_rest_node_http: summary(results),
  qdrant_rest_undici_request: summary(viaUndici),
  qdrant_rest_js_client_fetch: summary(viaClient),
};
mkdirSync("docs", { recursive: true });
writeFileSync("docs/parity.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
