-- AlterTable
ALTER TABLE "receipts" ADD COLUMN "auto_reviewed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "auto_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "auto_checked_at" TIMESTAMP(3);
