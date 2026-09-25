-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('cashier', 'branch_manager', 'root_admin', 'seo');

-- CreateEnum
CREATE TYPE "Lang" AS ENUM ('uz', 'ru');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'blocked');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('offer', 'privacy', 'marketing');

-- CreateEnum
CREATE TYPE "StationStatus" AS ENUM ('active', 'paused', 'closed');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('open', 'closed', 'reconciling', 'ok', 'flagged');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('applied', 'pending_review', 'rejected');

-- CreateEnum
CREATE TYPE "SpendStatus" AS ENUM ('applied', 'reversed');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('earn', 'spend', 'reverse', 'adjust', 'expire');

-- CreateEnum
CREATE TYPE "LedgerRefType" AS ENUM ('receipt', 'spend', 'dispute', 'manual', 'system');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('scheduled', 'active', 'ended', 'cancelled');

-- CreateEnum
CREATE TYPE "DisputeRefType" AS ENUM ('receipt', 'spend');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('open', 'upheld', 'reversed', 'adjusted');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'sent', 'failed', 'dead');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "tg_user_id" BIGINT,
    "first_name" TEXT NOT NULL,
    "lang" "Lang" NOT NULL DEFAULT 'uz',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "station_id" TEXT,
    "terminal_ids" TEXT[],

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_credentials" (
    "user_id" TEXT NOT NULL,
    "password_hash" TEXT,
    "pin_hash" TEXT,
    "totp_secret" TEXT,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),

    CONSTRAINT "staff_credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "version" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "cached_balance" BIGINT NOT NULL DEFAULT 0,
    "pending_amount" BIGINT NOT NULL DEFAULT 0,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "radius_m" INTEGER NOT NULL DEFAULT 300,
    "status" "StationStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminals" (
    "id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "cashier_id" TEXT NOT NULL,
    "terminal_ids" TEXT[],
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "declared_total" BIGINT,
    "claims_total" BIGINT,
    "status" "ShiftStatus" NOT NULL DEFAULT 'open',
    "flag_reason" TEXT,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "terminal_id" TEXT NOT NULL,
    "qr_t" TEXT NOT NULL,
    "qr_r" TEXT NOT NULL,
    "qr_c" TEXT NOT NULL,
    "qr_s" TEXT NOT NULL,
    "receipt_at" TIMESTAMP(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "promotion_id" TEXT,
    "bonus" BIGINT NOT NULL,
    "photo_id" TEXT,
    "tax_amount" BIGINT,
    "tax_verified" BOOLEAN NOT NULL DEFAULT false,
    "tax_checked_at" TIMESTAMP(3),
    "client_lat" DECIMAL(9,6),
    "client_lng" DECIMAL(9,6),
    "distance_m" INTEGER,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'applied',
    "review_reasons" TEXT[],
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "shift_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_photos" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delete_after" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spend_operations" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "cashier_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "SpendStatus" NOT NULL DEFAULT 'applied',
    "reversed_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reverse_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spend_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_ledger" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "delta" BIGINT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "ref_type" "LedgerRefType" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bonus_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "base_rate_bps" INTEGER NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bonus_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "station_ids" TEXT[],
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'scheduled',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "ref_type" "DisputeRefType" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "claimed_amount" BIGINT,
    "comment" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'open',
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "_PromotionToStation" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_tg_user_id_key" ON "users"("tg_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_station_id_key" ON "user_roles"("user_id", "role", "station_id");

-- CreateIndex
CREATE INDEX "consents_user_id_idx" ON "consents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cards_user_id_key" ON "cards"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cards_number_key" ON "cards"("number");

-- CreateIndex
CREATE UNIQUE INDEX "terminals_code_key" ON "terminals"("code");

-- CreateIndex
CREATE INDEX "terminals_station_id_idx" ON "terminals"("station_id");

-- CreateIndex
CREATE INDEX "shifts_station_id_status_idx" ON "shifts"("station_id", "status");

-- CreateIndex
CREATE INDEX "shifts_cashier_id_status_idx" ON "shifts"("cashier_id", "status");

-- CreateIndex
CREATE INDEX "receipts_card_id_created_at_idx" ON "receipts"("card_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "receipts_station_id_receipt_at_idx" ON "receipts"("station_id", "receipt_at");

-- CreateIndex
CREATE INDEX "receipts_status_idx" ON "receipts"("status");

-- CreateIndex
CREATE INDEX "receipts_shift_id_idx" ON "receipts"("shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_qr_t_qr_r_qr_c_key" ON "receipts"("qr_t", "qr_r", "qr_c");

-- CreateIndex
CREATE INDEX "receipt_photos_delete_after_idx" ON "receipt_photos"("delete_after");

-- CreateIndex
CREATE INDEX "spend_operations_cashier_id_created_at_idx" ON "spend_operations"("cashier_id", "created_at");

-- CreateIndex
CREATE INDEX "spend_operations_shift_id_idx" ON "spend_operations"("shift_id");

-- CreateIndex
CREATE INDEX "spend_operations_card_id_created_at_idx" ON "spend_operations"("card_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "bonus_ledger_card_id_created_at_idx" ON "bonus_ledger"("card_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "promotions_starts_at_ends_at_idx" ON "promotions"("starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "disputes_card_id_idx" ON "disputes"("card_id");

-- CreateIndex
CREATE INDEX "disputes_ref_type_ref_id_idx" ON "disputes"("ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_status_next_attempt_at_idx" ON "outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "_PromotionToStation_AB_unique" ON "_PromotionToStation"("A", "B");

-- CreateIndex
CREATE INDEX "_PromotionToStation_B_index" ON "_PromotionToStation"("B");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "receipt_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_photos" ADD CONSTRAINT "receipt_photos_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_operations" ADD CONSTRAINT "spend_operations_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_operations" ADD CONSTRAINT "spend_operations_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_operations" ADD CONSTRAINT "spend_operations_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_ledger" ADD CONSTRAINT "bonus_ledger_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_ledger" ADD CONSTRAINT "bonus_ledger_receipt_fkey" FOREIGN KEY ("ref_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_ledger" ADD CONSTRAINT "bonus_ledger_spend_fkey" FOREIGN KEY ("ref_id") REFERENCES "spend_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "dispute_receipt_fkey" FOREIGN KEY ("ref_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "dispute_spend_fkey" FOREIGN KEY ("ref_id") REFERENCES "spend_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromotionToStation" ADD CONSTRAINT "_PromotionToStation_A_fkey" FOREIGN KEY ("A") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromotionToStation" ADD CONSTRAINT "_PromotionToStation_B_fkey" FOREIGN KEY ("B") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
