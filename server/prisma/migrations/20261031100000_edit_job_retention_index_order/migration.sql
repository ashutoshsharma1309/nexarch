-- Corrects the column order of the retention index.
--
-- The previous migration created (status, completed_at) on the theory that
-- leading with the filtered column would serve both the predicate and the
-- ORDER BY. EXPLAIN says otherwise: the sweep filters `status IN (four
-- terminal values)`, and an IN-list on the leading column cannot produce an
-- ordered index walk, so Postgres used the pre-existing status index and
-- added a Sort node.
--
-- Measured on this database, with enable_seqscan off so the plan shows what
-- would be chosen at scale:
--   (status, completed_at) -> Bitmap Index Scan + Sort, cost 11.29
--   (completed_at, status) -> Index Scan, no Sort,      cost  8.15
--
-- Leading with completed_at gives the ORDER BY for free and lets LIMIT stop
-- early, which is the whole shape of the sweep: oldest finished rows first,
-- a bounded batch at a time.
DROP INDEX IF EXISTS "edit_jobs_status_completed_at_idx";

CREATE INDEX IF NOT EXISTS "edit_jobs_completed_at_status_idx"
  ON "edit_jobs" ("completed_at", "status");
