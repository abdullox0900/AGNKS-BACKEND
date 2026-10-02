-- AlterTable
ALTER TABLE "staff_credentials" DROP COLUMN "recovery_code_hash",
ADD COLUMN     "password_enc" TEXT;

