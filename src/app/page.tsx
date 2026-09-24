import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { loadChat, db } from "@/lib/memory";
import type { AgentUIMessage } from "@/lib/agent";
import Chat from "./chat";

// Server component: the chat id lives in the URL, so a reload restores the conversation from
// MongoDB instead of the browser.
export default async function Page({ searchParams }: PageProps<"/">) {
  const { chat } = await searchParams;
  if (typeof chat !== "string") redirect(`/?chat=${randomUUID().slice(0, 8)}`);
  const messages = (await loadChat(await db(), chat)) as AgentUIMessage[];
  return <Chat id={chat} initialMessages={messages} />;
}
