// MongoDB layer against the local container: a throwaway database per run, skipped if MongoDB
// isn't reachable.
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { validateUIMessages, type UIMessage } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTools } from "../src/lib/agent";
import * as memory from "../src/lib/memory";

const name = `agent_lab_test_${randomUUID().slice(0, 8)}`;
const up = await new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 1000 })
  .connect()
  .then(async (c) => (await c.close(), true))
  .catch(() => false);

describe.skipIf(!up)("memory (MongoDB)", () => {
  let d: Awaited<ReturnType<typeof memory.db>>;
  beforeAll(async () => {
    d = await memory.db(name);
    await memory.ensureIndexes(d);
  });
  afterAll(async () => {
    await d.dropDatabase();
    await memory.closeDb();
  });

  it("counts turns per session and keeps the first start time", async () => {
    await memory.startSession(d, "s1", "u1", "m");
    const first = await d.collection<{ _id: string; turns: number; started_at: Date }>("sessions").findOne({ _id: "s1" });
    await memory.startSession(d, "s1", "u1", "m");
    const again = await d.collection<{ _id: string; turns: number; started_at: Date }>("sessions").findOne({ _id: "s1" });
    expect(again?.turns).toBe(2);
    expect(again?.started_at).toEqual(first?.started_at);
  });

  it("recalls by keyword, scoped to the user, newest first for recent()", async () => {
    await memory.remember(d, "u1", "Is a pharmacist who wants human clinical evidence");
    await memory.remember(d, "u1", "Prefers short answers");
    await memory.remember(d, "u2", "Is a pharmacist too");
    expect(await memory.recall(d, "u1", "pharmacist")).toEqual(["Is a pharmacist who wants human clinical evidence"]);
    expect((await memory.recent(d, "u1"))[0]).toBe("Prefers short answers");
  });

  it("round-trips a chat with tool parts through validateUIMessages", async () => {
    // Regression: without ignoreUndefined the driver stored undefined fields as null and the
    // reloaded chat failed validation on the next turn.
    const messages: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "2",
        role: "assistant",
        parts: [
          { type: "step-start" },
          {
            type: "tool-recall",
            toolCallId: "t1",
            state: "output-available",
            input: { query: "x" },
            output: "nothing saved",
            providerExecuted: undefined,
          },
          { type: "text", text: "hello", state: "done", providerMetadata: undefined },
        ],
      },
    ];
    await memory.saveChat(d, "c1", "u1", messages);
    const loaded = await memory.loadChat(d, "c1");
    await expect(validateUIMessages({ messages: loaded, tools: buildTools(d, "u1", "c1") })).resolves.toHaveLength(2);
  });
});

describe("cost", () => {
  it("bills fresh input, output and cache tokens at list price", () => {
    const m = "global.anthropic.claude-haiku-4-5-20251001-v1:0";
    expect(memory.cost(m, { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(1);
    expect(memory.cost(m, { input: 10_000, output: 1_000, cacheRead: 100_000, cacheWrite: 0 })).toBe(0.025);
    expect(memory.cost("unknown", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});
