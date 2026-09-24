// MongoDB as the agent's operational store. The collections and fields match agent-memory-lab's
// memory.py, so its aggregation pipelines (and scripts/report.mts here) work on either runtime:
//
//   sessions    {_id: session_id, user_id, model, started_at, turns}
//   llm_calls   {session_id, user_id, ts, model, step, input_tokens, output_tokens,
//                cache_read_tokens, cache_write_tokens, latency_ms, ttft_ms, cost_usd, stop_reason}
//   tool_calls  {session_id, user_id, ts, tool, args, ok, error, latency_ms, result_chars}
//   memories    {user_id, text, session_id, created_at}
//   chats       {_id: chat_id, user_id, messages: UIMessage[], updated_at}
//
// The Python agent kept conversation state in LangGraph checkpoints. Here the AI SDK's UIMessage
// list is the state: loaded before each turn, saved whole when the stream ends.
import { MongoClient, type Db } from "mongodb";
import type { UIMessage } from "ai";

const URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
// A separate database from the Python agent's `agent_lab`, so each runtime sees only its own
// memories and telemetry.
export const DB = process.env.MONGODB_DB ?? "agent_lab_ts";

// USD per million tokens (Anthropic list prices for Haiku 4.5; cache writes are the 5-minute
// rate). Unknown models are logged with cost_usd: null rather than a guessed number.
const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  "global.anthropic.claude-haiku-4-5-20251001-v1:0": { in: 1.0, out: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
};

const globalForMongo = globalThis as unknown as { mongo?: Promise<MongoClient> };

/** One client per process (Next.js dev reloads modules, so it is cached on globalThis). */
export async function db(name = DB): Promise<Db> {
  // ignoreUndefined: by default the driver stores `undefined` fields as null, and a UIMessage
  // saved that way (rawInput: null, providerMetadata: null, ...) fails validateUIMessages when
  // the chat is loaded for the next turn.
  globalForMongo.mongo ??= new MongoClient(URI, { ignoreUndefined: true }).connect();
  return (await globalForMongo.mongo).db(name);
}

export async function closeDb(): Promise<void> {
  const client = globalForMongo.mongo;
  globalForMongo.mongo = undefined;
  if (client) await (await client).close();
}

export async function ensureIndexes(d: Db): Promise<void> {
  await Promise.all([
    // Every report filters or groups by session first, then sorts by time.
    d.collection("llm_calls").createIndex({ session_id: 1, ts: 1 }),
    d.collection("tool_calls").createIndex({ session_id: 1, ts: 1 }),
    // Per-tool latency across all sessions.
    d.collection("tool_calls").createIndex({ tool: 1, ts: -1 }),
    d.collection("sessions").createIndex({ user_id: 1, started_at: -1 }),
    // recall() is a keyword search scoped to one user: equality prefix + text index.
    d.collection("memories").createIndex({ user_id: 1, text: "text" }),
    d.collection("memories").createIndex({ user_id: 1, created_at: -1 }),
    d.collection("chats").createIndex({ user_id: 1, updated_at: -1 }),
  ]);
}

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

export function cost(model: string, t: Tokens): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const usd = (t.input * p.in + t.output * p.out + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

export async function startSession(d: Db, sessionId: string, userId: string, model: string) {
  await d.collection<{ _id: string }>("sessions").updateOne(
    { _id: sessionId },
    { $setOnInsert: { user_id: userId, model, started_at: new Date() }, $inc: { turns: 1 } },
    { upsert: true },
  );
}

export async function remember(d: Db, userId: string, text: string, sessionId: string | null = null) {
  await d.collection("memories").insertOne({ user_id: userId, text, session_id: sessionId, created_at: new Date() });
}

export async function recent(d: Db, userId: string, limit = 10): Promise<string[]> {
  const docs = await d
    .collection("memories")
    .find({ user_id: userId }, { projection: { text: 1 } })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map((m) => m.text as string);
}

export async function recall(d: Db, userId: string, query: string, limit = 5): Promise<string[]> {
  const docs = await d
    .collection("memories")
    .find({ user_id: userId, $text: { $search: query } }, { projection: { text: 1, score: { $meta: "textScore" } } })
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .toArray();
  return docs.map((m) => m.text as string);
}

type ChatDoc = { _id: string; user_id: string; messages: UIMessage[]; updated_at: Date };

export async function loadChat(d: Db, chatId: string): Promise<UIMessage[]> {
  const doc = await d.collection<ChatDoc>("chats").findOne({ _id: chatId });
  return doc?.messages ?? [];
}

export async function saveChat(d: Db, chatId: string, userId: string, messages: UIMessage[]) {
  await d
    .collection<ChatDoc>("chats")
    .updateOne({ _id: chatId }, { $set: { user_id: userId, messages, updated_at: new Date() } }, { upsert: true });
}

export async function logLlmCall(d: Db, doc: Record<string, unknown>) {
  await d.collection("llm_calls").insertOne({ ...doc, ts: new Date() });
}

export async function logToolCall(d: Db, doc: Record<string, unknown>) {
  await d.collection("tool_calls").insertOne({ ...doc, ts: new Date() });
}
