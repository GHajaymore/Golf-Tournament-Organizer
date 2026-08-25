-- The club's currency, as an ISO code.
--
-- `currencySymbol` held a bare symbol, which cannot say whether "$" means US,
-- Canadian, Australian or New Zealand dollars, and carries no information
-- about MINOR UNITS. Amounts are stored in minor units and every formatter
-- divided by a hundred -- right for dollars and pounds, wrong by a factor of
-- a hundred for yen, and silent when wrong.
--
-- Defaults to USD, which is exactly what every existing row already means.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD';

-- Carry across the clubs who had set a symbol, so nobody is moved off what
-- they were already showing. Only the unambiguous ones: a bare '$' stays USD
-- because guessing between four dollar currencies is worse than the default.
UPDATE "Organization" SET "currency" = 'GBP' WHERE "currencySymbol" = '£' AND "currency" = 'USD';
UPDATE "Organization" SET "currency" = 'EUR' WHERE "currencySymbol" = '€' AND "currency" = 'USD';
UPDATE "Organization" SET "currency" = 'JPY' WHERE "currencySymbol" = '¥' AND "currency" = 'USD';
