// BEIR-convention metrics, line for line the same as agent-memory-lab's metrics.py.
export function ndcgAtK(ranked: string[], rel: Record<string, number>, k = 10): number {
  const dcg = ranked.slice(0, k).reduce((s, d, i) => s + (rel[d] ?? 0) / Math.log2(i + 2), 0);
  const ideal = Object.values(rel).sort((a, b) => b - a).slice(0, k);
  const idcg = ideal.reduce((s, r, i) => s + r / Math.log2(i + 2), 0);
  return idcg ? dcg / idcg : 0;
}

export function recallAtK(ranked: string[], rel: Record<string, number>, k = 100): number {
  const relevant = Object.keys(rel).filter((d) => rel[d] > 0);
  const top = new Set(ranked.slice(0, k));
  return relevant.length ? relevant.filter((d) => top.has(d)).length / relevant.length : 0;
}

export function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.round((p / 100) * (s.length - 1)))];
}
