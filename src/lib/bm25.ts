// Query side of fastembed's "Qdrant/bm25" model, ported so the TypeScript agent hits the same
// sparse index the Python benchmark built. Documents were indexed with term frequencies; Qdrant
// applies IDF server-side, so a query is just its set of unique token ids, each with weight 1.
// fixtures/scifact-test.json checks this against the Python output for all 300 test queries.
import { readFileSync } from "node:fs";
import path from "node:path";
import { newStemmer } from "snowball-stemmers";
import { murmur3 } from "./murmur3";

const STOPWORDS = new Set(
  readFileSync(path.join(process.cwd(), "src/lib/stopwords-en.txt"), "utf8")
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter(Boolean),
);
const TOKEN_MAX_LENGTH = 40;
const stemmer = newStemmer("english");

// Python's `\w` is Unicode-aware: letters, digits, marks and connector punctuation (_).
const NON_WORD_OR_SPACE = /[^\p{L}\p{N}\p{M}\p{Pc}\s]/gu;
const NON_WORD = /[^\p{L}\p{N}\p{M}\p{Pc}]/gu;

export function tokens(text: string): string[] {
  const cleaned = text.replace(NON_WORD_OR_SPACE, " ").toLowerCase().replace(NON_WORD, " ");
  const out: string[] = [];
  for (const token of cleaned.split(/\s+/)) {
    if (!token || STOPWORDS.has(token) || token.length > TOKEN_MAX_LENGTH) continue;
    const stemmed = stemmer.stem(token);
    if (stemmed) out.push(stemmed);
  }
  return out;
}

export function sparseQuery(text: string): { indices: number[]; values: number[] } {
  const indices = [...new Set(tokens(text).map((t) => Math.abs(murmur3(t))))].sort((a, b) => a - b);
  return { indices, values: indices.map(() => 1) };
}
