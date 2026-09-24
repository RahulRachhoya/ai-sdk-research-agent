// bge-small-en-v1.5 query embeddings in-process with transformers.js (ONNX on CPU), matching the
// vectors the Python benchmark indexed: CLS pooling, L2-normalised, retrieval prefix on queries.
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export const DENSE_MODEL = "Xenova/bge-small-en-v1.5";
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

let extractor: Promise<FeatureExtractionPipeline> | undefined;

export async function denseQuery(text: string): Promise<number[]> {
  extractor ??= pipeline("feature-extraction", DENSE_MODEL, { dtype: "fp32" });
  const out = await (await extractor)(QUERY_PREFIX + text, { pooling: "cls", normalize: true });
  return Array.from(out.data as Float32Array);
}
