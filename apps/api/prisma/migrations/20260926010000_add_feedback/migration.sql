-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('suggestion', 'complaint');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('open', 'resolved');

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "kind" "FeedbackKind" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'open',
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_card_id_idx" ON "feedback"("card_id");

-- CreateIndex
CREATE INDEX "feedback_status_idx" ON "feedback"("status");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
