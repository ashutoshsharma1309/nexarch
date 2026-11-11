-- Durable execution history, and the columns an enhancement job needs.
--
-- Additive only: two new enum types, one new enum value, two columns with
-- defaults that describe every existing row correctly, two new tables.
--
-- CANCELLED is deliberately not added to the partial unique index from
-- 20261024150000: it is terminal, so a cancelled job must not hold the
-- project's one active slot. The new working stages live in the `stage`
-- column under status RUNNING, which that index already covers.
ALTER TYPE "EditJobStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TYPE "EditJobKind" AS ENUM ('EDIT', 'ENHANCEMENT');
CREATE TYPE "ExecutionJobKind" AS ENUM ('RUN', 'ENHANCEMENT');

ALTER TABLE "edit_jobs"
    ADD COLUMN "kind" "EditJobKind" NOT NULL DEFAULT 'EDIT',
    ADD COLUMN "cancel_requested" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "execution_events" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "job_kind" "ExecutionJobKind" NOT NULL,
    "job_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT,
    "stage" TEXT,
    "agent_id" TEXT,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_events_pkey" PRIMARY KEY ("id")
);

-- Serves both the uniqueness rule and "events for job J after seq N".
CREATE UNIQUE INDEX "execution_events_job_id_seq_key" ON "execution_events"("job_id", "seq");
CREATE INDEX "execution_events_project_id_created_at_idx" ON "execution_events"("project_id", "created_at");

ALTER TABLE "execution_events"
    ADD CONSTRAINT "execution_events_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "stage_usage" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "agent_id" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_usd" DOUBLE PRECISION,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_usage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stage_usage_job_id_created_at_idx" ON "stage_usage"("job_id", "created_at");
CREATE INDEX "stage_usage_project_id_created_at_idx" ON "stage_usage"("project_id", "created_at");

ALTER TABLE "stage_usage"
    ADD CONSTRAINT "stage_usage_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
