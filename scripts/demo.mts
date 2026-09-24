// The Python agent's scripted demo, run through the same chatTurn() stream the web UI uses.
// Three sessions for one user: the second turn of each depends on the stored chat history, and
// session c depends on long-term memory written in session a. Costs a few cents on Bedrock.
//
//     npx tsx scripts/demo.mts
import { randomUUID } from "node:crypto";
import { readUIMessageStream } from "ai";
import { chatTurn, type AgentUIMessage } from "../src/lib/agent";
import { denseQuery } from "../src/lib/dense";
import { closeDb } from "../src/lib/memory";

const DEMO: [string, string][] = [
  ["a", "I'm a pharmacist and I only care about human clinical evidence, not mouse studies. " +
        "Does vitamin D supplementation reduce the risk of fractures?"],
  ["a", "What about in elderly people specifically?"],
  ["b", "Is there evidence that statins affect cancer risk?"],
  ["b", "Summarise that in two sentences."],
  ["c", "Do beta blockers help after a heart attack?"],
];

await denseQuery("warm-up"); // load the ONNX model up front, not inside the first tool call
const run = randomUUID().slice(0, 6);
const userId = `demo-user-${run}`;

for (const [session, text] of DEMO) {
  const chatId = `ts-${run}-${session}`;
  const message = { id: randomUUID(), role: "user" as const, parts: [{ type: "text" as const, text }] };
  const t0 = performance.now();
  let firstText: number | undefined;
  let last: AgentUIMessage | undefined;
  const stream = await chatTurn({ chatId, userId, message });
  for await (const m of readUIMessageStream<AgentUIMessage>({ stream })) {
    if (firstText === undefined && m.parts.some((p) => p.type === "text" && p.text)) firstText = performance.now() - t0;
    last = m;
  }
  const tools = last?.parts.filter((p) => p.type.startsWith("tool-")).map((p) => p.type.slice(5)) ?? [];
  const answer = last?.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n\n") ?? "";
  console.log(`\n[${chatId}] > ${text}`);
  console.log(`  tools: ${tools.join(", ") || "none"} · first text ${Math.round(firstText ?? 0)} ms · total ${Math.round(performance.now() - t0)} ms`);
  console.log(answer);
}
await closeDb();
