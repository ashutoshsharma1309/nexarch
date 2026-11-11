-- Index for the finished-edit-job retention sweep.
--
-- The sweep selects `status IN (terminal) AND completed_at < cutoff`
-- ordered by `completed_at` ascending, in batches. The existing index on
-- `status` alone cannot serve it: four of the six EditJobStatus values are
-- terminal, so the predicate matches most of the table and Postgres falls
-- back to a sequential scan followed by a sort. Leading with `status` and
-- then `completed_at` makes the filter and the ordering one index walk.
--
-- CONCURRENTLY is deliberately NOT used: `prisma migrate deploy` runs each
-- migration inside a transaction, and CREATE INDEX CONCURRENTLY cannot run
-- in one. The table is small (one row per edit ever applied) so the brief
-- lock this takes is not worth a non-transactional migration.
CREATE INDEX IF NOT EXISTS "edit_jobs_status_completed_at_idx"
  ON "edit_jobs" ("status", "completed_at");
