"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart } from "ai";
import { useState } from "react";
import Link from "next/link";
import Markdown from "react-markdown";
import type { AgentUIMessage } from "@/lib/agent";
import styles from "./page.module.css";

type Props = {
  id: string;
  initialMessages: AgentUIMessage[];
  readOnly: boolean;
  exampleId: string;
  modelLabel: string;
};

export default function Chat({
  id,
  initialMessages,
  readOnly,
  exampleId,
  modelLabel,
}: Props) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat<AgentUIMessage>({
    id,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // Only the new message goes over the wire; the server loads the rest from MongoDB.
      prepareSendMessagesRequest: ({ messages, id }) => ({
        body: { id, message: messages.at(-1) },
      }),
    }),
  });
  const busy = status === "submitted" || status === "streaming";

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>SciFact research agent</h1>
        <p>
          {modelLabel} · Qdrant hybrid search · MongoDB memory.
          Chat <code>{id}</code>
        </p>
        <p>
          {readOnly ? (
            <>
              A saved conversation (read-only).{" "}
              <Link href="/?new">Start your own</Link>.
            </>
          ) : (
            <>
              Answers cite the 5,183 SciFact abstracts. Facts you state are
              remembered across your chats.{" "}
              <Link href={`/?chat=${exampleId}`}>See an example</Link> ·{" "}
              <Link href="/?new">New chat</Link>
            </>
          )}
        </p>
      </header>

      <ol className={styles.log}>
        {messages.map((m) => (
          <li
            key={m.id}
            className={m.role === "user" ? styles.user : styles.assistant}
          >
            {m.parts.map((part, i) => {
              if (part.type === "text") {
                return m.role === "user" ? (
                  <p key={i}>{part.text}</p>
                ) : (
                  <Markdown key={i}>{part.text}</Markdown>
                );
              }
              if (isToolUIPart(part)) {
                return (
                  <details key={i} className={styles.tool}>
                    <summary>
                      {getToolName(part)}({JSON.stringify(part.input ?? {})}) ·{" "}
                      {part.state}
                    </summary>
                    {part.state === "output-available" && (
                      <pre>{String(part.output)}</pre>
                    )}
                    {part.state === "output-error" && (
                      <pre>{part.errorText}</pre>
                    )}
                  </details>
                );
              }
              return null;
            })}
          </li>
        ))}
      </ol>

      {error && (
        <p className={styles.error}>Something went wrong: {error.message}</p>
      )}

      {!readOnly && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim() || busy) return;
            sendMessage({ text: input });
            setInput("");
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={1000}
            placeholder="Ask about a biomedical claim, e.g. Does vitamin D reduce fracture risk?"
          />
          <button type="submit" disabled={busy}>
            {busy ? "…" : "Send"}
          </button>
        </form>
      )}
    </main>
  );
}
