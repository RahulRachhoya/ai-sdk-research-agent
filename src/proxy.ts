import { NextResponse, type NextRequest } from "next/server";

export const VISITOR_COOKIE = "uid";

// Each browser gets its own random user id, so saved memories and chats are per visitor
// instead of shared by everyone who opens the demo.
export function proxy(request: NextRequest) {
  if (request.cookies.has(VISITOR_COOKIE)) return NextResponse.next();
  const uid = `web-${crypto.randomUUID()}`;
  request.cookies.set(VISITOR_COOKIE, uid); // visible to this request's page render too
  const response = NextResponse.next({ request });
  response.cookies.set(VISITOR_COOKIE, uid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export const config = { matcher: ["/", "/api/chat"] };
