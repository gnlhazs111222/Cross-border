-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN "sourceKey" TEXT;
ALTER TABLE "ImportBatch" ADD COLUMN "sourceHash" TEXT;
ALTER TABLE "ImportBatch" ADD COLUMN "sourceBytes" INTEGER;
ALTER TABLE "ImportBatch" ADD COLUMN "sourceMime" TEXT;
