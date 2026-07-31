-- 001_enable_pgvector.sql
--
-- Enables the pgvector extension required for all vector() column types.
-- Must be the first migration so subsequent migrations can use vector().
--
-- The pgvector/pgvector:pg16 Docker image ships with this extension
-- pre-installed; no separate build step is required.
--
-- This statement is idempotent (IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS vector;
