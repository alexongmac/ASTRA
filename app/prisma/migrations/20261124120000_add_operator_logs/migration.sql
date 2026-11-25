-- CreateTable
CREATE TABLE `operator_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `event_time` DATETIME(3) NOT NULL,
    `area` VARCHAR(64) NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `priority` VARCHAR(16) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Open',
    `message` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by_id` INTEGER NULL,

    INDEX `operator_logs_event_time_idx`(`event_time`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `operator_logs` ADD CONSTRAINT `operator_logs_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `operators`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
