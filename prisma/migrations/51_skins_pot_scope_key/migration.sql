-- The skins pot's unique key must include the scope.
--
-- A league night runs four games: front and back nine, each gross and net.
-- Keyed on (stageId, net) alone, saving the back-nine gross pot upserted the
-- front-nine gross one -- one row, so the front pot's entrants and their
-- stakes silently became the back pot's and the front game disappeared with
-- the money still recorded against it.
--
-- Idempotent, so it can be re-applied to any database without hand-editing
-- the migration ledger. Existing rows are all scope='full', so widening the
-- key cannot collide.
DROP INDEX IF EXISTS "SkinsPot_stageId_net_key";

CREATE UNIQUE INDEX IF NOT EXISTS "SkinsPot_stageId_net_scope_key"
  ON "SkinsPot"("stageId", "net", "scope");
