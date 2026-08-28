-- CreateTable
CREATE TABLE `graph_nodes` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NOT NULL,
    `type` ENUM('PROJECT', 'REQUIREMENT', 'FEATURE', 'COMPONENT', 'SERVICE', 'API', 'ENTITY', 'FIELD', 'FILE', 'MODULE', 'SECURITY_RULE', 'DEPENDENCY', 'TEST') NOT NULL,
    `canonical_name` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `metadata` JSON NOT NULL,
    `source_artifact_id` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `graph_nodes_project_id_type_idx`(`project_id`, `type`),
    INDEX `graph_nodes_run_id_idx`(`run_id`),
    UNIQUE INDEX `graph_nodes_project_id_type_canonical_name_key`(`project_id`, `type`, `canonical_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `graph_edges` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NOT NULL,
    `source_node_id` VARCHAR(191) NOT NULL,
    `target_node_id` VARCHAR(191) NOT NULL,
    `relationship` ENUM('CONTAINS', 'IMPLEMENTS', 'DEPENDS_ON', 'USES', 'CALLS', 'EXPOSES', 'PERSISTS', 'BELONGS_TO', 'GENERATES', 'VALIDATES', 'TESTS', 'SECURED_BY') NOT NULL,
    `metadata` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `graph_edges_project_id_source_node_id_idx`(`project_id`, `source_node_id`),
    INDEX `graph_edges_project_id_target_node_id_idx`(`project_id`, `target_node_id`),
    UNIQUE INDEX `graph_edges_source_node_id_target_node_id_relationship_key`(`source_node_id`, `target_node_id`, `relationship`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `graph_nodes` ADD CONSTRAINT `graph_nodes_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `graph_edges` ADD CONSTRAINT `graph_edges_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `graph_edges` ADD CONSTRAINT `graph_edges_source_node_id_fkey` FOREIGN KEY (`source_node_id`) REFERENCES `graph_nodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `graph_edges` ADD CONSTRAINT `graph_edges_target_node_id_fkey` FOREIGN KEY (`target_node_id`) REFERENCES `graph_nodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

