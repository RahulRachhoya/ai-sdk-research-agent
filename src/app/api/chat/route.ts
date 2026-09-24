import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { chatTurn } from "@/lib/agent";

// The client sends only its newest message; the server owns the history (MongoDB `chats`).
export async function POST(req: Request) {
  const { id, message }: { id: string; message: UIMessage } = await req.json();
  const stream = await chatTurn({ chatId: id, userId: process.env.DEMO_USER ?? "web-user", message });
  return createUIMessageStreamResponse({ stream });
}
