// MurmurHash3 x86 32-bit over UTF-8 bytes, seed 0, returned as a signed int32: the same value as
// Python's `mmh3.hash(token)`, which fastembed uses to turn BM25 tokens into sparse-vector indices.
const encoder = new TextEncoder();

export function murmur3(text: string, seed = 0): number {
  const bytes = encoder.encode(text);
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const nblocks = bytes.length >>> 2;
  let h = seed >>> 0;

  for (let i = 0; i < nblocks; i++) {
    const j = i * 4;
    let k = bytes[j] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16) | (bytes[j + 3] << 24);
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }

  const tail = nblocks * 4;
  let k = 0;
  switch (bytes.length & 3) {
    case 3:
      k ^= bytes[tail + 2] << 16;
    // falls through
    case 2:
      k ^= bytes[tail + 1] << 8;
    // falls through
    case 1:
      k ^= bytes[tail];
      k = Math.imul(k, c1);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, c2);
      h ^= k;
  }

  h ^= bytes.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
}
