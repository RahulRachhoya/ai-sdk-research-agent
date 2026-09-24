import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AgentUIMessage } from "@/lib/agent";
import { chatOwner, db, loadChat } from "@/lib/memory";
import { wakeSearch } from "@/lib/search";
import Chat from "./chat";

// A seeded, read-only conversation reviewers can open without spending anything.
const EXAMPLE_CHAT = "example";

// Server component: the chat id lives in the URL, so a reload restores the conversation from
// MongoDB instead of the browser. Visitors see their own chats and the example, nobody else's.
export default async function Page({ searchParams }: PageProps<"/">) {
  const { chat } = await searchParams;
  if (typeof chat !== "string") redirect(`/?chat=${randomUUID().slice(0, 8)}`);
  wakeSearch();
  const d = await db();
  const uid = (await cookies()).get("uid")?.value;
  const owner = await chatOwner(d, chat);
  if (owner && owner !== uid && chat !== EXAMPLE_CHAT)
    redirect(`/?chat=${randomUUID().slice(0, 8)}`);
  const messages = (await loadChat(d, chat)) as AgentUIMessage[];
  return (
    <Chat
      key={chat}
      id={chat}
      initialMessages={messages}
      readOnly={chat === EXAMPLE_CHAT}
      exampleId={EXAMPLE_CHAT}
    />
  );
}
