-- CreateTable
CREATE TABLE "ImportResolutionRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportResolutionRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportResolutionRule_userId_verdict_field_key" ON "ImportResolutionRule"("userId", "verdict", "field");
