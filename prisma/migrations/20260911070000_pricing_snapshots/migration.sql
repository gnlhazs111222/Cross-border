-- CreateTable
CREATE TABLE "PricingSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "settlementCurrency" TEXT NOT NULL DEFAULT 'USD',
    "exchangePair" TEXT NOT NULL,
    "exchangeRate" REAL NOT NULL,
    "exchangeSource" TEXT NOT NULL,
    "exchangeReferenceDate" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL,
    "shippingAmount" REAL NOT NULL,
    "shippingConfigVersion" TEXT NOT NULL,
    "shippingSource" TEXT NOT NULL,
    "dutyAmount" REAL NOT NULL,
    "dutyRuleVersion" TEXT NOT NULL,
    "dutySource" TEXT NOT NULL,
    "platformFeeAmount" REAL NOT NULL,
    "platformFeeVersion" TEXT NOT NULL,
    "platformFeeSource" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricingSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PricingSnapshot_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "LaunchTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingSnapshot_taskId_version_key" ON "PricingSnapshot"("taskId", "version");
CREATE UNIQUE INDEX "PricingSnapshot_userId_code_key" ON "PricingSnapshot"("userId", "code");
CREATE INDEX "PricingSnapshot_userId_taskId_createdAt_idx" ON "PricingSnapshot"("userId", "taskId", "createdAt");

-- Backfill existing tasks so upgrading a populated demo does not leave a task without provenance.
INSERT INTO "PricingSnapshot" (
    "id", "userId", "taskId", "code", "version", "platform", "market", "settlementCurrency",
    "exchangePair", "exchangeRate", "exchangeSource", "exchangeReferenceDate", "fetchedAt",
    "shippingAmount", "shippingConfigVersion", "shippingSource",
    "dutyAmount", "dutyRuleVersion", "dutySource",
    "platformFeeAmount", "platformFeeVersion", "platformFeeSource", "policyVersion", "createdAt"
)
SELECT
    'pricing_' || lower(hex(randomblob(12))), "userId", "id", 'PCS-' || "code" || '-v1', 1, "platform", "market", 'USD',
    'CNY/USD', 0.139, 'Demo approved exchange-rate table', '2026-09-01', CURRENT_TIMESTAMP,
    3.10, 'shipping-us-demo-v1', 'Demo US parcel profile',
    0.70, 'duty-us-demo-v1', 'Demo landed-cost rule table',
    2.20, 'platform-us-demo-v1', 'Demo marketplace fee profile', 'pricing-context-demo-v1', CURRENT_TIMESTAMP
FROM "LaunchTask";
