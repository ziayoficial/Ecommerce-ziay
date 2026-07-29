// ZIAY — Embedding service
//
// Provides text embeddings for semantic search across messages (Saramantha §3)
// and products (catalog visual-primero search).
//
// In dev (SQLite): uses a deterministic 256-dim hash embedding — fast, free,
// and good enough for prototype semantic search. Results are stored in the
// `embedding` Bytes column on Message and `embeddingTexto`/`embeddingVisual`
// Bytes columns on Product.
//
// In prod (PostgreSQL + pgvector): swap `embed()` for a real embedding API
// (OpenAI text-embedding-3-small, Cohere, or a local sentence-transformer).
// The interface stays the same.
//
// BUILD-AGENTS-LIB-001

import { db } from '@/lib/db'

export const EMBED_DIM = 256

export interface SimilarResult {
  id: string
  score: number
  kind: 'message' | 'product'
  snippet?: string
  meta?: Record<string, unknown>
}

/**
 * Generate a deterministic 256-dim embedding for a piece of text.
 *
 * Dev-only hash embedding: uses FNV-1a on 4-gram shingles to produce a
 * pseudo-random but reproducible vector. Not semantically meaningful at the
 * level of a real model, but cheap and stable — good enough to wire up the
 * semantic-search UX before swapping in a real embedder.
 *
 * @param text - The text to embed. Empty/null returns a zero vector.
 */
export function embed(text: string): number[] {
  const vec = new Float64Array(EMBED_DIM)
  if (!text || text.trim().length === 0) {
    return Array.from(vec, () => 0)
  }
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()
  // Word-level shingles (1-grams and 2-grams)
  const tokens = normalized.split(' ').filter(Boolean)
  const shingles: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    shingles.push(tokens[i])
    if (i < tokens.length - 1) shingles.push(`${tokens[i]}_${tokens[i + 1]}`)
  }
  // Character 4-grams for fuzzy matching
  for (let i = 0; i + 4 <= normalized.length; i += 2) {
    shingles.push(`c:${normalized.slice(i, i + 4)}`)
  }
  if (shingles.length === 0) return Array.from(vec, () => 0)
  for (const sh of shingles) {
    const hash = fnv1a(sh)
    const idx = hash % EMBED_DIM
    const sign = (hash >> 8) % 2 === 0 ? 1 : -1
    vec[idx] += sign
  }
  // L2 normalize
  let norm = 0
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm)
  if (norm === 0) return Array.from(vec, () => 0)
  return Array.from(vec, (v) => v / norm)
}

/**
 * Cosine similarity between two vectors (assumes same dimensionality).
 * Returns a value in [-1, 1]; higher is more similar.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * Embed a message body and persist it to the `Message.embedding` column.
 *
 * @param messageId - Existing message ID (must already be in the DB).
 * @param text      - The message body to embed.
 */
export async function embedAndStoreMessage(messageId: string, text: string): Promise<void> {
  const vec = embed(text)
  const buf = Buffer.from(new Float32Array(vec).buffer)
  await db.message.update({
    where: { id: messageId },
    data: { embedding: buf },
  })
}

/**
 * Embed a product's textual representation (name + description + design +
 * category) and persist it to `Product.embeddingTexto`. The `kind` argument
 * distinguishes between text and visual embeddings; for now we only support
 * text.
 *
 * @param productId - Existing product ID.
 * @param text      - The text to embed.
 * @param kind      - 'texto' (default) or 'visual'. Only 'texto' is supported
 *                    by this function; 'visual' should be set by the vision
 *                    pipeline.
 */
export async function embedAndStoreProduct(
  productId: string,
  text: string,
  kind: 'texto' | 'visual' = 'texto',
): Promise<void> {
  const vec = embed(text)
  const buf = Buffer.from(new Float32Array(vec).buffer)
  if (kind === 'texto') {
    await db.product.update({ where: { id: productId }, data: { embeddingTexto: buf } })
  } else {
    await db.product.update({ where: { id: productId }, data: { embeddingVisual: buf } })
  }
}

export interface SearchSimilarOptions {
  tenantId: string
  /** Restrict search to a specific kind. Defaults to 'product'. */
  kind?: 'message' | 'product'
  /** Max number of results. Defaults to 5. */
  topK?: number
  /** Minimum cosine similarity to include. Defaults to 0.1. */
  minScore?: number
  /** Optional conversationId filter (only for kind='message'). */
  conversationId?: string
}

/**
 * Semantic search across messages or products in a tenant.
 *
 * Loads candidates from the DB (limited to the most recent 500 for messages,
 * or all active for products), computes cosine similarity client-side, and
 * returns the top-K matches above `minScore`.
 *
 * In production with pgvector, replace this with a single SQL query:
 *   SELECT id, embedding <=> $1 AS score FROM ... WHERE "tenantId" = $2 ORDER BY score LIMIT $3
 *
 * @param text  - The query text to embed and search for.
 * @param opts  - Search options.
 */
export async function searchSimilar(text: string, opts: SearchSimilarOptions): Promise<SimilarResult[]> {
  const q = embed(text)
  const kind = opts.kind ?? 'product'
  const topK = opts.topK ?? 5
  const minScore = opts.minScore ?? 0.1

  const results: SimilarResult[] = []

  if (kind === 'product') {
    const products = await db.product.findMany({
      where: { tenantId: opts.tenantId, active: true },
      take: 1000,
      select: {
        id: true,
        name: true,
        diseno: true,
        categoria: true,
        description: true,
        price: true,
        sku: true,
        embeddingTexto: true,
      },
    })
    for (const p of products) {
      if (!p.embeddingTexto) continue
      const pv = bufferToVector(p.embeddingTexto)
      const score = cosineSimilarity(q, pv)
      if (score >= minScore) {
        results.push({
          id: p.id,
          score,
          kind: 'product',
          snippet: `${p.name} [${p.diseno ?? 'liso'}] ${p.categoria ?? ''} $${p.price} — SKU ${p.sku}`,
          meta: { sku: p.sku, name: p.name, price: p.price, diseno: p.diseno, categoria: p.categoria },
        })
      }
    }
  } else {
    const messages = await db.message.findMany({
      where: {
        tenantId: opts.tenantId,
        ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
        embedding: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { id: true, body: true, embedding: true, conversationId: true, direction: true },
    })
    for (const m of messages) {
      if (!m.embedding) continue
      const mv = bufferToVector(m.embedding)
      const score = cosineSimilarity(q, mv)
      if (score >= minScore) {
        results.push({
          id: m.id,
          score,
          kind: 'message',
          snippet: m.body.slice(0, 160),
          meta: { conversationId: m.conversationId, direction: m.direction },
        })
      }
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, topK)
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash.
 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

/**
 * Decode a Bytes column (Uint8Array in Prisma 6+) back to a number[].
 * Accepts both `Buffer` and `Uint8Array` since both share the same memory layout.
 */
function bufferToVector(buf: Uint8Array): number[] {
  const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(arr)
}
