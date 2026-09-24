// search_papers' backend. Locally the Next.js server embeds the query and queries Qdrant itself.
// Deployed, the embedding model is too big for a Vercel function (onnxruntime-node alone is
// ~290 MB against a 250 MB limit), so it runs as a separate service (service/search.mts, on
// Render) and the Vercel app calls it with a shared token.
import type { Hit } from "./qdrant";

const SEARCH_URL = process.env.SEARCH_URL;
const SEARCH_TOKEN = process.env.SEARCH_TOKEN;

export async function searchPapers(query: string, limit = 5): Promise<Hit[]> {
  if (!SEARCH_URL) return (await import("./qdrant")).hybrid(query, limit);
  const res = await fetch(`${SEARCH_URL}/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SEARCH_TOKEN}`,
    },
    body: JSON.stringify({ query, limit }),
    signal: AbortSignal.timeout(90_000), // a sleeping free-tier service takes up to a minute to wake
  });
  if (!res.ok) throw new Error(`search service failed (${res.status})`);
  return ((await res.json()) as { hits: Hit[] }).hits;
}

/** Fire-and-forget: wake the search service while the visitor is still typing. */
export function wakeSearch(): void {
  if (SEARCH_URL)
    fetch(`${SEARCH_URL}/health`, {
      signal: AbortSignal.timeout(90_000),
    }).catch(() => {});
}
