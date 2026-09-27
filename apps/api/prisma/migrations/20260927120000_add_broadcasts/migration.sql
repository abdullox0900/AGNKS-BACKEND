-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('scheduled', 'sending', 'sent', 'cancelled');

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "text_uz" TEXT NOT NULL,
    "text_ru" TEXT,
    "send_at" TIMESTAMP(3) NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'scheduled',
    "promotion_id" TEXT,
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broadcasts_status_send_at_idx" ON "broadcasts"("status", "send_at");

-- CreateIndex
CREATE INDEX "broadcasts_promotion_id_idx" ON "broadcasts"("promotion_id");

