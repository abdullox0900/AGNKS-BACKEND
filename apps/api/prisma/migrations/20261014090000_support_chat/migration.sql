-- Support chat on feedback threads, reply templates, and the reason a card was blocked.
-- Additive only: new enum value, new nullable/defaulted columns, new tables.
ALTER TYPE "FeedbackKind" ADD VALUE IF NOT EXISTS 'appeal';
CREATE TYPE "FeedbackSender" AS ENUM ('client', 'staff');

ALTER TABLE "feedback"
  ADD COLUMN "last_client_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "last_staff_message_at" TIMESTAMP(3),
  ADD COLUMN "staff_seen_at" TIMESTAMP(3),
  ADD COLUMN "client_seen_at" TIMESTAMP(3);

-- existing threads: the first message was written when the thread was created, and the dashboard has already
-- been showing them, so they start out as "seen" (no flood of unread badges after the update)
UPDATE "feedback" SET "last_client_message_at" = "created_at", "staff_seen_at" = CURRENT_TIMESTAMP;

ALTER TABLE "cards"
  ADD COLUMN "blocked_reason" TEXT,
  ADD COLUMN "blocked_at" TIMESTAMP(3);

CREATE TABLE "feedback_messages" (
    "id" TEXT NOT NULL,
    "feedback_id" TEXT NOT NULL,
    "sender" "FeedbackSender" NOT NULL,
    "author_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "feedback_templates" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text_uz" TEXT NOT NULL,
    "text_ru" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feedback_messages_feedback_id_created_at_idx" ON "feedback_messages"("feedback_id", "created_at");

ALTER TABLE "feedback_messages" ADD CONSTRAINT "feedback_messages_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
