-- DropIndex
DROP INDEX `projects_slug_key` ON `projects`;

-- AlterTable
ALTER TABLE `projects` ADD COLUMN `favorite` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX `projects_owner_id_slug_key` ON `projects`(`owner_id`, `slug`);

