-- One active edit per project, enforced by the database.
--
-- The service checked for an active job and then created one, which is a
-- check-then-act race: two requests a few milliseconds apart both saw no
-- active job, both rebuilt from the same baseline, and the slower one's work
-- vanished while both reported success. A double-click was enough.
--
-- A partial unique index is the only place this can be enforced correctly,
-- because it is the only place that sees both requests.
CREATE UNIQUE INDEX "edit_jobs_one_active_per_project"
    ON "edit_jobs"("project_id")
    WHERE "status" IN ('QUEUED', 'RUNNING');
