ALTER TABLE "Product" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
UPDATE "Product" SET "position" = (
  SELECT COUNT(*) FROM "Product" AS earlier
  WHERE earlier."userId" = "Product"."userId" AND earlier.rowid < "Product".rowid
);
