-- CreateTable
CREATE TABLE `shift_handovers` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `area` VARCHAR(64) NOT NULL,
    `machine` VARCHAR(64) NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'On-Going',
    `start_time` DATETIME(3) NOT NULL,
    `end_time` DATETIME(3) NULL,
    `summary` TEXT NULL,
    `health_safety` TEXT NULL,
    `checklist` JSON NULL,
    `outgoing_decision` VARCHAR(16) NULL,
    `incoming_decision` VARCHAR(16) NULL,
    `outgoing_operator_id` INTEGER NULL,
    `incoming_operator_id` INTEGER NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `shift_handovers_start_time_idx`(`start_time`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift_handover_logs` (
    `handover_id` BIGINT NOT NULL,
    `log_id` BIGINT NOT NULL,

    INDEX `shift_handover_logs_log_id_idx`(`log_id`),
    PRIMARY KEY (`handover_id`, `log_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift_handover_attachments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `handover_id` BIGINT NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(127) NOT NULL,
    `size` INTEGER NOT NULL,
    `data` LONGBLOB NOT NULL,
    `comment` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shift_handover_attachments_handover_id_idx`(`handover_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `shift_handovers` ADD CONSTRAINT `shift_handovers_outgoing_operator_id_fkey` FOREIGN KEY (`outgoing_operator_id`) REFERENCES `operators`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_handovers` ADD CONSTRAINT `shift_handovers_incoming_operator_id_fkey` FOREIGN KEY (`incoming_operator_id`) REFERENCES `operators`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_handovers` ADD CONSTRAINT `shift_handovers_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `operators`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_handover_logs` ADD CONSTRAINT `shift_handover_logs_handover_id_fkey` FOREIGN KEY (`handover_id`) REFERENCES `shift_handovers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_handover_logs` ADD CONSTRAINT `shift_handover_logs_log_id_fkey` FOREIGN KEY (`log_id`) REFERENCES `operator_logs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_handover_attachments` ADD CONSTRAINT `shift_handover_attachments_handover_id_fkey` FOREIGN KEY (`handover_id`) REFERENCES `shift_handovers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

