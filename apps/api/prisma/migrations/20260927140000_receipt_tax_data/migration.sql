-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "large_ack_at" TIMESTAMP(3),
ADD COLUMN     "large_ack_by" TEXT,
ADD COLUMN     "tax_data" JSONB,
ADD COLUMN     "tax_source" TEXT;

