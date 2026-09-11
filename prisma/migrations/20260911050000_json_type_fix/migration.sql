-- Prisma maps Json to JSONB on SQLite; the earlier hand-written migrations used JSON, which the
-- client cannot decode. Rebuild the two tables that carry JSON payloads with the correct type.
PRAGMA foreign_keys=OFF;

CREATE TABLE "ImportBatch_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdProducts" INTEGER NOT NULL DEFAULT 0,
    "counts" JSONB NOT NULL,
    "report" JSONB,
    "sourceKey" TEXT,
    "sourceHash" TEXT,
    "sourceBytes" INTEGER,
    "sourceMime" TEXT,
    "urlResults" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "ImportBatch_new" SELECT "id","userId","fileName","mode","status","rowCount","createdProducts","counts","report","sourceKey","sourceHash","sourceBytes","sourceMime","urlResults","createdAt","updatedAt" FROM "ImportBatch";
DROP TABLE "ImportBatch";
ALTER TABLE "ImportBatch_new" RENAME TO "ImportBatch";
CREATE INDEX "ImportBatch_userId_createdAt_idx" ON "ImportBatch"("userId", "createdAt");

CREATE TABLE "ImportOccurrence_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "sku" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "verdict" TEXT NOT NULL,
    "matchedProductId" TEXT,
    "matchedSku" TEXT,
    "conflicts" JSONB,
    "payload" JSONB NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'pending',
    "resolvedProductId" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportOccurrence_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportOccurrence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "ImportOccurrence_new" SELECT "id","batchId","userId","rowNumber","sku","name","verdict","matchedProductId","matchedSku","conflicts","payload","resolution","resolvedProductId","resolvedAt","createdAt","updatedAt" FROM "ImportOccurrence";
DROP TABLE "ImportOccurrence";
ALTER TABLE "ImportOccurrence_new" RENAME TO "ImportOccurrence";
CREATE INDEX "ImportOccurrence_userId_resolution_idx" ON "ImportOccurrence"("userId", "resolution");
CREATE INDEX "ImportOccurrence_batchId_idx" ON "ImportOccurrence"("batchId");

PRAGMA foreign_keys=ON;