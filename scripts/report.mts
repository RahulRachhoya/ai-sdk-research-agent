// The aggregation pipelines from agent-memory-lab's report.py, over this agent's telemetry:
// cost and tokens per session, latency percentiles per tool and per LLM step, and time to first
// output (which only a streaming agent has). $percentile needs MongoDB 7.0+.
//
//     npx tsx scripts/report.mts [session-prefix]
import { closeDb, db } from "../src/lib/memory";

const P = [0.5, 0.95];
const prefix = process.argv[2] ?? "";
const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const match = { $match: { session_id: { $regex: "^" + escaped } } };
const d = await db();

const perSession = await d.collection("llm_calls").aggregate([
  match,
  { $group: {
      _id: "$session_id", llm_calls: { $sum: 1 },
      input_tokens: { $sum: "$input_tokens" }, output_tokens: { $sum: "$output_tokens" },
      cache_read_tokens: { $sum: "$cache_read_tokens" }, cost_usd: { $sum: "$cost_usd" },
      llm_ms: { $sum: "$latency_ms" }, first: { $min: "$ts" } } },
  // Join tool calls for the same session; the (session_id, ts) index serves the inner match.
  { $lookup: { from: "tool_calls", localField: "_id", foreignField: "session_id",
      pipeline: [{ $group: { _id: null, n: { $sum: 1 }, ms: { $sum: "$latency_ms" },
                             errors: { $sum: { $cond: ["$ok", 0, 1] } } } }],
      as: "tools" } },
  { $unwind: { path: "$tools", preserveNullAndEmptyArrays: true } },
  { $sort: { first: 1 } },
  { $replaceWith: {
      session_id: "$_id", llm_calls: "$llm_calls", input_tokens: "$input_tokens",
      output_tokens: "$output_tokens", cache_read_tokens: "$cache_read_tokens",
      cost_usd: { $round: ["$cost_usd", 5] },
      tool_calls: { $ifNull: ["$tools.n", 0] }, tool_errors: { $ifNull: ["$tools.errors", 0] },
      llm_ms: { $round: ["$llm_ms", 0] }, tool_ms: { $round: [{ $ifNull: ["$tools.ms", 0] }, 0] } } },
]).toArray();

const perTool = await d.collection("tool_calls").aggregate([
  match,
  { $group: { _id: "$tool", calls: { $sum: 1 }, errors: { $sum: { $cond: ["$ok", 0, 1] } },
              pct: { $percentile: { input: "$latency_ms", p: P, method: "approximate" } },
              avg_result_chars: { $avg: "$result_chars" } } },
  { $sort: { calls: -1 } },
  { $replaceWith: { tool: "$_id", calls: "$calls", errors: "$errors",
      p50_ms: { $round: [{ $arrayElemAt: ["$pct", 0] }, 1] },
      p95_ms: { $round: [{ $arrayElemAt: ["$pct", 1] }, 1] },
      avg_result_chars: { $round: ["$avg_result_chars", 0] } } },
]).toArray();

const llm = await d.collection("llm_calls").aggregate([
  match,
  { $group: { _id: "$model", calls: { $sum: 1 },
              pct: { $percentile: { input: "$latency_ms", p: P, method: "approximate" } },
              ttft: { $percentile: { input: "$ttft_ms", p: P, method: "approximate" } },
              out_tok_p50: { $median: { input: "$output_tokens", method: "approximate" } } } },
  { $replaceWith: { model: "$_id", calls: "$calls",
      p50_ms: { $round: [{ $arrayElemAt: ["$pct", 0] }, 0] },
      p95_ms: { $round: [{ $arrayElemAt: ["$pct", 1] }, 0] },
      ttft_p50_ms: { $round: [{ $arrayElemAt: ["$ttft", 0] }, 0] },
      ttft_p95_ms: { $round: [{ $arrayElemAt: ["$ttft", 1] }, 0] },
      out_tok_p50: "$out_tok_p50" } },
]).toArray();

function table(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "(no rows)";
  const cols = Object.keys(rows[0]);
  return [`| ${cols.join(" | ")} |`, `|${"---|".repeat(cols.length)}`,
    ...rows.map((r) => `| ${cols.map((c) => String(r[c] ?? "")).join(" | ")} |`)].join("\n");
}

for (const [title, rows] of [["Per session", perSession], ["Per tool", perTool], ["LLM latency", llm]] as const) {
  console.log(`\n### ${title}\n\n${table(rows)}`);
}
await closeDb();
