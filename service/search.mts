// The search service the deployed app calls (see src/lib/search.ts): embeds the query with
// bge-small (transformers.js), builds the BM25 query and runs the hybrid query against Qdrant.
//
//     SEARCH_TOKEN=... QDRANT_URL=... QDRANT_API_KEY=... npx tsx service/search.mts
//     npx tsx service/search.mts --warm    # download the model into the cache and exit (build step)
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { denseQuery } from "../src/lib/dense";
import { hybrid } from "../src/lib/qdrant";

await denseQuery("warm-up"); // load the model before accepting traffic
if (process.argv.includes("--warm")) process.exit(0);

const TOKEN = Buffer.from(process.env.SEARCH_TOKEN ?? "");
if (TOKEN.length < 32)
  throw new Error("SEARCH_TOKEN must be set (32+ characters)");

function authorized(header: string | undefined): boolean {
  const got = Buffer.from(header?.replace(/^Bearer /, "") ?? "");
  return got.length === TOKEN.length && timingSafeEqual(got, TOKEN);
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res
    .writeHead(status, { "content-type": "application/json" })
    .end(JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    // Uptime monitors (UptimeRobot keeps the free instance awake) default to HEAD on the root URL.
    if ((req.method === "GET" || req.method === "HEAD") && (req.url === "/" || req.url === "/health"))
      return send(res, 200, { ok: true });
    if (req.method !== "POST" || req.url !== "/search")
      return send(res, 404, { error: "not found" });
    if (!authorized(req.headers.authorization))
      return send(res, 401, { error: "unauthorized" });
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) return send(res, 413, { error: "too large" });
    }
    try {
      const { query, limit = 5 } = JSON.parse(raw) as {
        query?: unknown;
        limit?: unknown;
      };
      if (typeof query !== "string" || !query.trim() || query.length > 500)
        return send(res, 400, { error: "bad query" });
      const n = Math.min(Math.max(Number(limit) || 5, 1), 10);
      send(res, 200, { hits: await hybrid(query, n) });
    } catch (e) {
      console.error(e);
      send(res, 500, { error: "search failed" });
    }
  })
  .listen(Number(process.env.PORT ?? 8790), () =>
    console.log(`search service on :${process.env.PORT ?? 8790}`),
  );
