"""Writes fixtures/scifact-test.json: the 300 SciFact test queries with their qrels and, from the
Python reference implementation (agent-memory-lab), each query's BM25 token ids, dense query
vector and hybrid top 10. The TypeScript port is checked against this file.

Run with agent-memory-lab's environment, from this repo's root:
    uv run --project ../agent-memory-lab python scripts/make_fixture.py
"""
import json
import os
from pathlib import Path

os.chdir(Path(__file__).resolve().parents[1] / ".." / "agent-memory-lab")  # its model/data caches

from agent_memory_lab import data, embed, qdrant_store  # noqa: E402

sf = data.load()
qc = qdrant_store.client()
rows = []
for qid, text in sf.queries.items():
    dense, sparse = embed.dense_query(text), embed.sparse_query(text)
    rows.append({
        "id": qid,
        "text": text,
        "qrels": sf.qrels[qid],
        "bm25_ids": sorted(int(i) for i in sparse.indices),
        "dense": [round(x, 5) for x in dense],
        "hybrid_top10": qdrant_store.hybrid(qc, dense, sparse, 10),
    })
out = Path(__file__).resolve().parents[1] / "fixtures" / "scifact-test.json"
out.write_text(json.dumps(rows))
print(f"wrote {len(rows)} queries to {out}")
