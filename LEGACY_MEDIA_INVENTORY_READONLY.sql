-- Count-only legacy inline-image inventory.
--
-- SAFETY: run only on an owner-approved isolated/sanitized snapshot, never against
-- any production endpoint (including read replicas). Connect with a read-only DB role.
-- This opens a repeatable-read, READ ONLY transaction, returns only field names and
-- row counts, and rolls back. It does not return values, URLs, row IDs, or image bytes.
--
-- Detection scope: literal `data:image` markers in PostgreSQL text, varchar, char,
-- JSON/JSONB, and text-array columns in public base tables. It will not detect arbitrary
-- encodings, binary values, or image data stored outside those column types. Neon must
-- continue to contain no binary media. Large tables may hit the timeout; coordinate with
-- the DBA before increasing it. This file was prepared for review and has not been run.
--
-- Usage, only after owner/DBA approval and with an isolated/read-only target configured:
--   psql -X -v ON_ERROR_STOP=1 --dbname "$LEGACY_MEDIA_READONLY_DATABASE_URL" \
--     --file LEGACY_MEDIA_INVENTORY_READONLY.sql

\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- psql's \gexec runs the generated SELECT-only UNION. Identifiers are quoted with
-- format(%I), the detection literal is quoted with format(%L), and no values are selected.
SELECT
  string_agg(
    format(
      'SELECT %L::text AS field, count(*) FILTER (WHERE strpos(lower(%I::text), %L) > 0) AS matching_rows FROM %I.%I',
      table_schema || '.' || table_name || '.' || column_name,
      column_name,
      'data:image',
      table_schema,
      table_name
    ),
    E'\nUNION ALL\n'
  ) || E'\nORDER BY field' AS generated_sql
FROM information_schema.columns AS c
JOIN information_schema.tables AS t USING (table_schema, table_name)
WHERE c.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND c.table_name <> '_prisma_migrations'
  AND (
    c.data_type IN ('character varying', 'character', 'text', 'json', 'jsonb')
    OR (c.data_type = 'ARRAY' AND c.udt_name = '_text')
  )
\gexec

ROLLBACK;
