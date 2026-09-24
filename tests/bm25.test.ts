import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sparseQuery } from "../src/lib/bm25";
import { murmur3 } from "../src/lib/murmur3";

type Row = { id: string; text: string; bm25_ids: number[] };
const rows: Row[] = JSON.parse(readFileSync("fixtures/scifact-test.json", "utf8"));

describe("murmur3", () => {
  it("matches mmh3.hash reference values", () => {
    // python -c "import mmh3; print(mmh3.hash(''), mmh3.hash('hello'), mmh3.hash('café'))"
    expect(murmur3("")).toBe(0);
    expect(murmur3("hello")).toBe(613153351);
    expect(murmur3("café")).toBe(605818632);
  });
});

describe("bm25 query tokens", () => {
  it("reproduces fastembed's token ids for all 300 SciFact test queries", () => {
    const mismatches = rows.filter((r) => {
      const got = sparseQuery(r.text).indices;
      return JSON.stringify(got) !== JSON.stringify(r.bm25_ids);
    });
    expect(mismatches.map((r) => r.id)).toEqual([]);
    expect(rows).toHaveLength(300);
  });
});
