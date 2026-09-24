// A small research agent over SciFact, the TypeScript counterpart of agent-memory-lab's agent.py:
// Claude Haiku 4.5 on Bedrock (or a Groq-hosted model for the public demo) via the Vercel AI SDK, retrieval from Qdrant (hybrid BM25 + dense),
// conversation state, long-term memory and per-call telemetry in MongoDB.
//
// chatTurn() is the whole server side of one turn. The Next.js route streams its output to the
// browser and scripts/demo.mts drains the same stream in a terminal, so both go through the same
// persistence and logging path.
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { createGroq } from "@ai-sdk/groq";
import {
  convertToModelMessages,
  isStepCount,
  streamText,
  tool,
  toUIMessageStream,
  validateUIMessages,
  type InferUITools,
  type UIMessage,
} from "ai";
import type { Db } from "mongodb";
import { z } from "zod";
import * as memory from "./memory";
import { searchPapers } from "./search";

// Locally (and for every number in the README): Claude Haiku 4.5 on Bedrock via an AWS profile.
// The public demo sets LLM_PROVIDER=groq so the deployment holds no AWS credentials at all, only a
// Groq API key.
const GROQ = process.env.LLM_PROVIDER === "groq";
export const MODEL = GROQ
  ? (process.env.GROQ_MODEL ?? "openai/gpt-oss-120b")
  : "global.anthropic.claude-haiku-4-5-20251001-v1:0";
const MAX_STEPS = 8;

const llm = GROQ
  ? createGroq({ apiKey: process.env.GROQ_API_KEY })(MODEL)
  : createAmazonBedrock({
      region: process.env.AWS_REGION ?? "ap-south-1",
      credentialProvider: fromNodeProviderChain({
        profile: process.env.AWS_PROFILE ?? "claude-bedrock",
      }),
    })(MODEL);

// Same prompt as the Python agent, so the two runs are comparable.
const SYSTEM = `You answer questions about biomedical research claims using the SciFact abstracts.
Always call search_papers before answering a factual question and cite abstract ids like [12345].
If the user states a preference or a fact about themselves, call remember. Facts saved in earlier
conversations are listed below; call recall to search for older ones. Be concise.`;

export function buildTools(d: Db, userId: string, sessionId: string) {
  return {
    search_papers: tool({
      description:
        "Search 5,183 SciFact abstracts (hybrid BM25 + dense). Returns the top 5.",
      inputSchema: z.object({
        query: z.string().describe("What to search for"),
      }),
      execute: async ({ query }) => {
        const top = await searchPapers(query, 5);
        return top
          .map((h) => `[${h.id}] ${h.title}\n${h.text.slice(0, 600)}`)
          .join("\n\n");
      },
    }),
    remember: tool({
      description:
        "Save a durable fact or preference about the user for future conversations.",
      inputSchema: z.object({ fact: z.string() }),
      execute: async ({ fact }) => {
        await memory.remember(d, userId, fact, sessionId);
        return "saved";
      },
    }),
    recall: tool({
      description:
        "Look up facts previously saved about the user (keyword search).",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const found = await memory.recall(d, userId, query);
        return found.map((m) => `- ${m}`).join("\n") || "nothing saved";
      },
    }),
  };
}

export type AgentUIMessage = UIMessage<
  never,
  never,
  InferUITools<ReturnType<typeof buildTools>>
>;

let indexed: Promise<void> | undefined;

/** Runs one user turn of chat `chatId` and returns the UI message stream for it. */
export async function chatTurn({
  chatId,
  userId,
  message,
}: {
  chatId: string;
  userId: string;
  message: UIMessage;
}) {
  const d = await memory.db();
  indexed ??= memory.ensureIndexes(d);
  await indexed;
  await memory.startSession(d, chatId, userId, MODEL);

  const tools = buildTools(d, userId, chatId);
  const messages = await validateUIMessages<AgentUIMessage>({
    messages: [...(await memory.loadChat(d, chatId)), message],
    tools,
  });

  // Saved memories go into the prompt on every turn instead of relying on the model to call
  // recall: in the Python agent's first demo run it never did, and answered without them.
  const known = await memory.recent(d, userId);
  const instructions = `${SYSTEM}\n\nSaved facts about this user:\n${known.map((m) => `- ${m}`).join("\n") || "(none)"}`;

  // Telemetry writes are started from the callbacks and awaited before the chat is saved, so a
  // finished turn always has its llm_calls and tool_calls in MongoDB.
  const pending: Promise<unknown>[] = [];
  const base = { session_id: chatId, user_id: userId };

  const result = streamText({
    model: llm,
    instructions,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    temperature: 0,
    maxOutputTokens: 1024,
    onStepEnd: ({
      stepNumber,
      usage,
      performance,
      rawFinishReason,
      finishReason,
    }) => {
      // The SDK's inputTokens includes cached tokens; bill the three kinds separately.
      const tokens = {
        input: usage.inputTokenDetails.noCacheTokens ?? usage.inputTokens ?? 0,
        output: usage.outputTokens ?? 0,
        cacheRead: usage.inputTokenDetails.cacheReadTokens ?? 0,
        cacheWrite: usage.inputTokenDetails.cacheWriteTokens ?? 0,
      };
      pending.push(
        memory.logLlmCall(d, {
          ...base,
          model: MODEL,
          step: stepNumber,
          input_tokens: tokens.input,
          output_tokens: tokens.output,
          cache_read_tokens: tokens.cacheRead,
          cache_write_tokens: tokens.cacheWrite,
          latency_ms: Math.round(performance.responseTimeMs * 10) / 10,
          ttft_ms:
            performance.timeToFirstOutputMs == null
              ? null
              : Math.round(performance.timeToFirstOutputMs),
          cost_usd: memory.cost(MODEL, tokens),
          stop_reason: rawFinishReason ?? finishReason,
        }),
      );
    },
    onToolExecutionEnd: ({ toolCall, toolExecutionMs, toolOutput }) => {
      const ok = toolOutput.type === "tool-result";
      pending.push(
        memory.logToolCall(d, {
          ...base,
          tool: toolCall.toolName,
          args: toolCall.input,
          ok,
          error: ok ? null : String(toolOutput.error).slice(0, 500),
          latency_ms: Math.round(toolExecutionMs * 10) / 10,
          result_chars: ok ? String(toolOutput.output).length : 0,
        }),
      );
    },
  });

  // Run the turn to completion (and save it) even if the browser disconnects mid-stream.
  result.consumeStream();

  return toUIMessageStream({
    stream: result.stream,
    tools,
    originalMessages: messages,
    onEnd: async ({ messages: final }) => {
      await Promise.all(pending);
      await memory.saveChat(d, chatId, userId, final);
    },
  });
}
