-- Applying an edit becomes a background job.
--
-- The work takes five to six minutes, and running it inside one HTTP request
-- made the client's timeout a race: the request failed while the server
-- applied the edit anyway, so the next edit started from a project the user
-- believed unchanged. The row is durable so that a restart mid-edit can be
-- reported as an interruption rather than assumed to be either outcome.
-- Additive: no existing table or column changes meaning.
CREATE TYPE "EditJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'REJECTED', 'FAILED', 'INTERRUPTED');

CREATE TABLE "edit_jobs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" "EditJobStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT NOT NULL,
    "stages" JSONB NOT NULL,
    "instruction" TEXT NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "run_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edit_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "edit_jobs_project_id_created_at_idx" ON "edit_jobs"("project_id", "created_at");
CREATE INDEX "edit_jobs_status_idx" ON "edit_jobs"("status");

ALTER TABLE "edit_jobs"
    ADD CONSTRAINT "edit_jobs_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
