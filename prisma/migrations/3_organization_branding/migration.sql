-- Club branding for the console header and printed output.
--
-- `logoUrl` is a URL rather than an uploaded file: uploads need blob storage
-- and a signing/serving path, while nearly every club already hosts a logo on
-- its own site. Swapping this for an upload later only changes what writes the
-- column, not anything that reads it.

ALTER TABLE "Organization" ADD COLUMN "logoUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Organization" ADD COLUMN "shortName" TEXT NOT NULL DEFAULT '';
