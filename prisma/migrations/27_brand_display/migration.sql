-- How a club's name renders beside its logo.
--
-- "short" reproduces what the console did before this existed — the short
-- name, falling back to the full one — so no club's header changes until
-- someone chooses otherwise.
ALTER TABLE "Organization" ADD COLUMN "brandDisplay" TEXT NOT NULL DEFAULT 'short';
