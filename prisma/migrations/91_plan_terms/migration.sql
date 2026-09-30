-- Plan terms apply to NEW clubs only. Every existing row takes the default,
-- false, which grandfathers it: nothing it holds is capped or deleted.

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "planTermsApply" BOOLEAN NOT NULL DEFAULT false;
