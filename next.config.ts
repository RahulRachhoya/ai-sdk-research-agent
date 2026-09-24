import type { NextConfig } from "next";

// On Vercel search runs in the separate search service (src/lib/search.ts), so keep the embedding
// runtime out of the function bundle: onnxruntime-node alone is over Vercel's 250 MB limit.
const excludeEmbedding = process.env.SEARCH_URL
  ? {
      "*": [
        "node_modules/onnxruntime-node/**",
        "node_modules/onnxruntime-web/**",
        "node_modules/@huggingface/transformers/**",
        "node_modules/sharp/**",
        "node_modules/@img/**",
      ],
    }
  : undefined;

const nextConfig: NextConfig = {
  outputFileTracingExcludes: excludeEmbedding,
};

export default nextConfig;
