ALTER TABLE "ListingDraft" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'stale';
ALTER TABLE "ListingDraft" ADD COLUMN "generationMode" TEXT NOT NULL DEFAULT 'template';
ALTER TABLE "ReviewResult" ADD COLUMN "reviewMode" TEXT NOT NULL DEFAULT 'rules';
ALTER TABLE "ReviewResult" ADD COLUMN "highRiskCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReviewResult" ADD COLUMN "invalidatedAt" DATETIME;
ALTER TABLE "PublishResult" ADD COLUMN "externalDemoId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PublishResult" ADD COLUMN "invalidatedAt" DATETIME;
-- Pre-migration rows were not server-authorized business results. Retain them as invalid history.
UPDATE "ReviewResult" SET "invalidatedAt" = CURRENT_TIMESTAMP;
UPDATE "PublishResult" SET "invalidatedAt" = CURRENT_TIMESTAMP;
