-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_seen_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "client_activity_days" (
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "client_activity_days_pkey" PRIMARY KEY ("user_id","day")
);

-- CreateIndex
CREATE INDEX "client_activity_days_day_idx" ON "client_activity_days"("day");

-- AddForeignKey
ALTER TABLE "client_activity_days" ADD CONSTRAINT "client_activity_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

