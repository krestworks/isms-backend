/*
  Warnings:

  - You are about to drop the column `type` on the `disciplinaryrecord` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `DisciplinaryRecord` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `disciplinaryrecord` DROP COLUMN `type`,
    ADD COLUMN `appeal` TEXT NULL,
    ADD COLUMN `category` VARCHAR(191) NOT NULL DEFAULT 'Misconduct',
    ADD COLUMN `hearingDate` DATETIME(3) NULL,
    ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `offence` TEXT NULL,
    ADD COLUMN `outcome` VARCHAR(191) NULL,
    ADD COLUMN `reportedBy` VARCHAR(191) NULL,
    ADD COLUMN `stage` VARCHAR(191) NOT NULL DEFAULT 'Informal Action',
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL;

-- CreateTable
CREATE TABLE `Payroll` (
    `id` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `basicSalary` DOUBLE NOT NULL DEFAULT 0,
    `houseAllowance` DOUBLE NOT NULL DEFAULT 0,
    `transportAllowance` DOUBLE NOT NULL DEFAULT 0,
    `overtimePay` DOUBLE NOT NULL DEFAULT 0,
    `grossPay` DOUBLE NOT NULL DEFAULT 0,
    `nhif` DOUBLE NOT NULL DEFAULT 0,
    `nssf` DOUBLE NOT NULL DEFAULT 0,
    `paye` DOUBLE NOT NULL DEFAULT 0,
    `otherDeductions` DOUBLE NOT NULL DEFAULT 0,
    `totalDeductions` DOUBLE NOT NULL DEFAULT 0,
    `netPay` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `payDate` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Payroll_employeeId_month_key`(`employeeId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PerformanceTask` (
    `id` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'General',
    `dueDate` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'todo',
    `priority` VARCHAR(191) NOT NULL DEFAULT 'medium',
    `notes` TEXT NULL,
    `rating` INTEGER NULL,
    `assignedBy` VARCHAR(191) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Payroll` ADD CONSTRAINT `Payroll_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceTask` ADD CONSTRAINT `PerformanceTask_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
