-- AlterTable
ALTER TABLE "broadcasts" ADD COLUMN     "station_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

