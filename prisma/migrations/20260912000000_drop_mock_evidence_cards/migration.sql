-- The demo no longer claims PDF or image parsing. Those two evidence cards were seeded mock data, not
-- extraction results, so V1 cards are now created with the supplier sheet row only. This removes the
-- legacy rows that databases created by earlier versions still hold, which the UI would keep rendering.
DELETE FROM "Evidence" WHERE "kind" IN ('pdf', 'image');
