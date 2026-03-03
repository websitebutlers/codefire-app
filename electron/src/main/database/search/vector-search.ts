/**
 * Vector search utilities for cosine similarity over embeddings stored in SQLite BLOBs.
 */

/**
 * Convert a Buffer (from SQLite BLOB) to Float32Array
 */
export function blobToFloat32Array(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)
}

/**
 * Convert Float32Array to Buffer (for storing in SQLite)
 */
export function float32ArrayToBlob(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value in [-1, 1] where 1 = identical direction, 0 = orthogonal, -1 = opposite.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const magnitude = Math.sqrt(magA) * Math.sqrt(magB)
  return magnitude === 0 ? 0 : dot / magnitude
}

/**
 * Find top-N most similar chunks to a query embedding.
 * Performs brute-force cosine similarity scan over all chunks.
 */
export function vectorSearch(
  queryEmbedding: Float32Array,
  chunks: Array<{ id: string; embedding: Buffer; [key: string]: unknown }>,
  topN: number = 10
): Array<{ id: string; score: number }> {
  const scores = chunks.map((chunk) => ({
    id: chunk.id,
    score: cosineSimilarity(queryEmbedding, blobToFloat32Array(chunk.embedding)),
  }))
  scores.sort((a, b) => b.score - a.score)
  return scores.slice(0, topN)
}
