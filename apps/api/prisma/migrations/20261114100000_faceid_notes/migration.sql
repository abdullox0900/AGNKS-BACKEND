-- CreateTable
CREATE TABLE "faceid_notes" (
    "employee_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faceid_notes_pkey" PRIMARY KEY ("employee_id","date")
);

-- CreateIndex
CREATE INDEX "faceid_notes_date_idx" ON "faceid_notes"("date");
