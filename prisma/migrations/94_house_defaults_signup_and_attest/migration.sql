-- Two house defaults the club's form has always shown and never stored:
-- weekly sign-up, and how many playing partners must confirm a card. Both
-- take the value every tournament already starts with, so no club's next
-- tournament changes until somebody chooses otherwise.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "defaultAttendanceMode" TEXT NOT NULL DEFAULT 'everyone',
ADD COLUMN     "defaultAttestBy" TEXT NOT NULL DEFAULT 'marker';
