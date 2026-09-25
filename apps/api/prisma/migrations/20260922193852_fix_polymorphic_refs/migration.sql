-- DropForeignKey
ALTER TABLE "bonus_ledger" DROP CONSTRAINT "bonus_ledger_receipt_fkey";

-- DropForeignKey
ALTER TABLE "bonus_ledger" DROP CONSTRAINT "bonus_ledger_spend_fkey";

-- DropForeignKey
ALTER TABLE "disputes" DROP CONSTRAINT "dispute_receipt_fkey";

-- DropForeignKey
ALTER TABLE "disputes" DROP CONSTRAINT "dispute_spend_fkey";

-- CreateIndex
CREATE INDEX "bonus_ledger_ref_type_ref_id_idx" ON "bonus_ledger"("ref_type", "ref_id");
