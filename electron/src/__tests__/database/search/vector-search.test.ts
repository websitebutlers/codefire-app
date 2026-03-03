import { describe, it, expect } from 'vitest'
import {
  cosineSimilarity,
  blobToFloat32Array,
  float32ArrayToBlob,
  vectorSearch,
} from '../../../main/database/search/vector-search'

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const a = new Float32Array([1, 2, 3])
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0)
  })

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([0, 1])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0)
  })

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([-1, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0)
  })

  it('handles zero vectors', () => {
    const a = new Float32Array([0, 0])
    const b = new Float32Array([1, 1])
    expect(cosineSimilarity(a, b)).toBe(0)
  })

  it('handles high-dimensional vectors', () => {
    const dim = 384
    const a = new Float32Array(dim)
    const b = new Float32Array(dim)
    for (let i = 0; i < dim; i++) {
      a[i] = Math.random() - 0.5
      b[i] = a[i] // identical
    }
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0)
  })

  it('is commutative', () => {
    const a = new Float32Array([1, 2, 3, 4])
    const b = new Float32Array([5, 6, 7, 8])
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a))
  })
})

describe('blob conversion', () => {
  it('roundtrips Float32Array through Buffer', () => {
    const original = new Float32Array([1.5, -2.3, 0.0, 999.99])
    const blob = float32ArrayToBlob(original)
    const recovered = blobToFloat32Array(blob)
    expect(recovered.length).toBe(original.length)
    for (let i = 0; i < original.length; i++) {
      expect(recovered[i]).toBeCloseTo(original[i])
    }
  })

  it('handles empty Float32Array', () => {
    const original = new Float32Array([])
    const blob = float32ArrayToBlob(original)
    const recovered = blobToFloat32Array(blob)
    expect(recovered.length).toBe(0)
  })

  it('preserves exact binary representation', () => {
    const original = new Float32Array([Math.PI, Math.E, -Infinity, 0])
    const blob = float32ArrayToBlob(original)
    const recovered = blobToFloat32Array(blob)
    expect(recovered[0]).toBe(original[0])
    expect(recovered[1]).toBe(original[1])
    expect(recovered[2]).toBe(original[2])
    expect(recovered[3]).toBe(original[3])
  })

  it('produces a Buffer with correct byte length', () => {
    const arr = new Float32Array([1, 2, 3])
    const blob = float32ArrayToBlob(arr)
    expect(blob.byteLength).toBe(arr.length * 4) // 4 bytes per float32
  })
})

describe('vectorSearch', () => {
  it('returns top-N results sorted by similarity', () => {
    const queryEmbedding = new Float32Array([1, 0, 0])

    const chunks = [
      { id: 'a', embedding: float32ArrayToBlob(new Float32Array([1, 0, 0])) },     // identical
      { id: 'b', embedding: float32ArrayToBlob(new Float32Array([0.9, 0.1, 0])) }, // very similar
      { id: 'c', embedding: float32ArrayToBlob(new Float32Array([0, 1, 0])) },     // orthogonal
      { id: 'd', embedding: float32ArrayToBlob(new Float32Array([-1, 0, 0])) },    // opposite
    ]

    const results = vectorSearch(queryEmbedding, chunks, 2)
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('a')
    expect(results[0].score).toBeCloseTo(1.0)
    expect(results[1].id).toBe('b')
    expect(results[1].score).toBeGreaterThan(0.9)
  })

  it('returns all chunks if topN exceeds count', () => {
    const queryEmbedding = new Float32Array([1, 0])
    const chunks = [
      { id: 'a', embedding: float32ArrayToBlob(new Float32Array([1, 0])) },
      { id: 'b', embedding: float32ArrayToBlob(new Float32Array([0, 1])) },
    ]

    const results = vectorSearch(queryEmbedding, chunks, 10)
    expect(results).toHaveLength(2)
  })

  it('handles empty chunks array', () => {
    const queryEmbedding = new Float32Array([1, 0])
    const results = vectorSearch(queryEmbedding, [], 5)
    expect(results).toHaveLength(0)
  })

  it('defaults to top 10', () => {
    const queryEmbedding = new Float32Array([1, 0])
    const chunks = Array.from({ length: 20 }, (_, i) => ({
      id: `chunk-${i}`,
      embedding: float32ArrayToBlob(new Float32Array([Math.cos(i * 0.1), Math.sin(i * 0.1)])),
    }))

    const results = vectorSearch(queryEmbedding, chunks)
    expect(results).toHaveLength(10)
  })

  it('preserves extra properties in chunk objects', () => {
    const queryEmbedding = new Float32Array([1, 0])
    const chunks = [
      { id: 'a', embedding: float32ArrayToBlob(new Float32Array([1, 0])), extra: 'data' },
    ]

    const results = vectorSearch(queryEmbedding, chunks, 5)
    expect(results[0].id).toBe('a')
    expect(results[0].score).toBeCloseTo(1.0)
  })
})
