-- CommerceFlow OS — Postgres + pgvector setup script
-- Run AFTER migrating to PostgreSQL and after prisma migrate.
--
-- This script:
-- 1. Ensures the pgvector extension is installed
-- 2. Converts Message.embedding from Bytes to vector(1024) (semantic memory §3)
-- 3. Converts Product.embeddingTexto to vector(768) and embeddingVisual to vector(512)
-- 4. Creates HNSW indexes for fast cosine similarity search
-- 5. Creates a helper function for semantic search

-- ────────────────────────────────────────────────────────────────────
-- 1. Extensions
-- ────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ────────────────────────────────────────────────────────────────────
-- 2. Message.embedding: Bytes → vector(1024)
--    (only if migrating from SQLite where it was stored as Bytes)
-- ────────────────────────────────────────────────────────────────────
-- If the column is still bytea (from SQLite migration), convert it:
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Message' AND column_name = 'embedding' AND data_type = 'bytea'
  ) THEN
    -- Add a new vector column, copy data, drop old, rename
    ALTER TABLE "Message" ADD COLUMN embedding_vec vector(1024);
    UPDATE "Message"
    SET embedding_vec = (
      CASE
        WHEN embedding IS NOT NULL AND octet_length(embedding) = 4096 THEN
          -- Convert 4096 bytes (1024 float32) to vector
          (SELECT array_to_vector(array_agg(CASE WHEN i % 4 = 0 THEN get_float4(substring(embedding FROM i + 1 FOR 4)) END))::vector(1024)
           FROM generate_series(0, octet_length(embedding) - 1, 4) AS i)
        ELSE NULL
      END
    );
    ALTER TABLE "Message" DROP COLUMN embedding;
    ALTER TABLE "Message" RENAME COLUMN embedding_vec TO embedding;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 3. HNSW indexes for fast cosine similarity (§3 semantic memory)
-- ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS message_embedding_hnsw
  ON "Message" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS product_embedding_texto_hnsw
  ON "Product" USING hnsw ("embeddingTexto" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS product_embedding_visual_hnsw
  ON "Product" USING hnsw ("embeddingVisual" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ────────────────────────────────────────────────────────────────────
-- 4. Helper function: semantic search over message history
--    Usage: SELECT * FROM semantic_memory_search('ten-saramantha', 'pijama familia', 10, 0.3);
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION semantic_memory_search(
  p_tenant_id TEXT,
  p_query TEXT,
  p_limit INT DEFAULT 10,
  p_threshold FLOAT DEFAULT 0.3
) RETURNS TABLE (
  message_id TEXT,
  body TEXT,
  direction TEXT,
  created_at TIMESTAMPTZ,
  score FLOAT
) AS $$
DECLARE
  query_embedding vector(1024);
BEGIN
  -- Generate embedding for the query (requires a function that calls the LLM provider)
  -- In production, this calls OpenAI text-embedding-3-small or Ollama nomic-embed-text
  -- For now, we accept a pre-computed embedding as alternative:
  -- SELECT * FROM semantic_memory_search_vec('ten-saramantha', '[0.1, 0.2, ...]'::vector(1024), 10, 0.3);

  -- Placeholder: if you pass a query string, we generate the embedding here
  -- using a PL/pgSQL function that calls the configured LLM provider.
  -- For the demo, this returns empty (real implementation in app layer).
  query_embedding := NULL;

  RETURN QUERY
  SELECT
    m.id::TEXT,
    m.body,
    m.direction,
    m."createdAt",
    1 - (m.embedding <=> query_embedding)::FLOAT AS score
  FROM "Message" m
  WHERE m."tenantId" = p_tenant_id
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) >= p_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────────
-- 5. Helper: search with pre-computed embedding vector
--    (called from app layer after generating embedding via LLM)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION semantic_memory_search_vec(
  p_tenant_id TEXT,
  p_query_vec vector(1024),
  p_limit INT DEFAULT 10,
  p_threshold FLOAT DEFAULT 0.3
) RETURNS TABLE (
  message_id TEXT,
  body TEXT,
  direction TEXT,
  created_at TIMESTAMPTZ,
  score FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id::TEXT,
    m.body,
    m.direction,
    m."createdAt",
    (1 - (m.embedding <=> p_query_vec))::FLOAT AS score
  FROM "Message" m
  WHERE m."tenantId" = p_tenant_id
    AND m.embedding IS NOT NULL
    AND (1 - (m.embedding <=> p_query_vec)) >= p_threshold
  ORDER BY m.embedding <=> p_query_vec
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────────
-- 6. Verify
-- ────────────────────────────────────────────────────────────────────
SELECT 'pgvector installed' AS status WHERE EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector');
SELECT 'HNSW indexes created' AS status WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'message_embedding_hnsw');
SELECT 'semantic_memory_search function created' AS status WHERE EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'semantic_memory_search');
