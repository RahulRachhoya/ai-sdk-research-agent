import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { cookies } from "next/headers";
import { chatTurn } from "@/lib/agent";
import { MAX_CHAT_MESSAGES, MAX_MESSAGE_CHARS, refuse } from "@/lib/limits";
import { chatOwner, db, loadChat } from "@/lib/memory";

// The client sends only its newest message; the server owns the history (MongoDB `chats`).
export async function POST(req: Request) {
  const { id, message }: { id: string; message: UIMessage } = await req.json();
  const userId = (await cookies()).get("uid")?.value;
  if (!userId) return new Response("Reload the page to start a chat.", { status: 400 });
  if (typeof id !== "string" || !/^[\w-]{1,40}$/.test(id)) return new Response("Bad chat id.", { status: 400 });

  const text = message?.parts?.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "";
  if (!text.trim() || text.length > MAX_MESSAGE_CHARS) {
    return new Response(`Messages must be 1 to ${MAX_MESSAGE_CHARS} characters.`, { status: 400 });
  }

  const d = await db();
  const owner = await chatOwner(d, id);
  if (owner && owner !== userId) return new Response("This chat is read-only. Start a new one.", { status: 403 });
  if ((await loadChat(d, id)).length >= MAX_CHAT_MESSAGES) {
    return new Response("This chat is at its length limit. Start a new one.", { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const refused = await refuse(d, userId, ip);
  if (refused) return new Response(refused, { status: 429 });

  const stream = await chatTurn({ chatId: id, userId, message });
  return createUIMessageStreamResponse({ stream });
}
