-- A fourball can run its own skins or Nassau, alongside the field's.
--
-- Until now the unique keys were [stageId, net, scope] and [stageId, kind],
-- which permit exactly ONE skins pot and one game of each kind per round. Two
-- groups each running a $20 skins on the same round collided, and an upsert
-- against that key silently overwrote the first group's pot — the same failure
-- that lost the back-nine pot when the key was [stageId, net].
--
-- groupKey is the tee-sheet group's NAME, or '' for the whole field. Every row
-- that exists gets '', so every pot keeps exactly the meaning it had.
--
-- Idempotent throughout: these migrations are re-applied by hand against a
-- database that must never be reset.

ALTER TABLE "SkinsPot" ADD COLUMN IF NOT EXISTS "groupKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SideGame" ADD COLUMN IF NOT EXISTS "groupKey" TEXT NOT NULL DEFAULT '';

-- Swap each unique index for one that includes the group. Dropping first is
-- safe because the replacement is strictly wider: any pair of rows distinct
-- under the old key stays distinct under the new one.
DROP INDEX IF EXISTS "SkinsPot_stageId_net_scope_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SkinsPot_stageId_net_scope_groupKey_key"
    ON "SkinsPot" ("stageId", "net", "scope", "groupKey");

DROP INDEX IF EXISTS "SideGame_stageId_kind_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SideGame_stageId_kind_groupKey_key"
    ON "SideGame" ("stageId", "kind", "groupKey");
