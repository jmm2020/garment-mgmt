-- Backfill product_variants.sku from fg_sku for rows that existed before the
-- structured-FG-SKU columns landed in 0001. The unique index on `sku` (added in
-- 0001) tolerates multiple NULLs, so this migration is safe to run idempotently
-- and is also safe to re-run if some variants were partially backfilled by hand.
--
-- We do NOT backfill the dimension columns (line/model/color/size_dim/gender/
-- season_dim/fabric_type) because we can't reliably parse them from arbitrary
-- legacy fg_sku strings. Operators populate those on the next edit, and Zod
-- enforces them on all newly created variants. See ADR-0005 §3.
UPDATE "product_variants"
   SET "sku" = "fg_sku"
 WHERE "sku" IS NULL;
