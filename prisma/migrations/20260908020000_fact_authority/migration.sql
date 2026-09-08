ALTER TABLE "FactCard" ADD COLUMN "productRevision" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "FactCard_taskId_productId_version_revision_key";
CREATE UNIQUE INDEX "FactCard_taskId_productId_version_key" ON "FactCard"("taskId", "productId", "version");
