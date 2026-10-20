-- What a run produced is now durable.
--
-- Generated code lived only in the API process's memory, so a restart left
-- every completed run with nothing to show: no Code tab, no preview, no
-- editable baseline, and a knowledge graph pointing at files that no longer
-- existed anywhere. Additive — nothing existing changes meaning.
CREATE TABLE "run_artifacts" (
    "run_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "file_count" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_artifacts_pkey" PRIMARY KEY ("run_id")
);

CREATE INDEX "run_artifacts_project_id_created_at_idx"
    ON "run_artifacts"("project_id", "created_at");

ALTER TABLE "run_artifacts"
    ADD CONSTRAINT "run_artifacts_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
