-- AlterEnum
BEGIN;
CREATE TYPE "ShiftStatus_new" AS ENUM ('open', 'closed');
ALTER TABLE "shifts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "shifts" ALTER COLUMN "status" TYPE "ShiftStatus_new" USING ("status"::text::"ShiftStatus_new");
ALTER TYPE "ShiftStatus" RENAME TO "ShiftStatus_old";
ALTER TYPE "ShiftStatus_new" RENAME TO "ShiftStatus";
DROP TYPE "ShiftStatus_old";
ALTER TABLE "shifts" ALTER COLUMN "status" SET DEFAULT 'open';
COMMIT;

-- AlterTable
ALTER TABLE "staff_credentials" ADD COLUMN     "recovery_code_hash" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "registered_at" TIMESTAMP(3);

