import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { parseOfferSettings, type OfferSettings } from "@/lib/plans";

/**
 * WHERE THE EVENT PASSES, THE SEASONAL PLAN AND THEIR "ON SALE" SWITCH ARE KEPT.
 *
 * Beside `platform-pricing.ts`: one `PlatformSetting` row, read through
 * `parseOfferSettings`, which refuses to throw. A blip or a corrupt row reads
 * as the decided defaults with the switch OFF, which is the safe direction:
 * nothing is ever put on sale by a failure.
 *
 * THIS IS THE OWNER'S READER. The owner console reads it whole. Any other
 * surface must pass what it reads through `publicOffers` (`plans.ts`), which
 * is empty while the switch is off; `offers-are-not-on-sale.test.ts` refuses a
 * file outside the owner's that reads this and does not.
 */

const OFFERS_KEY = "offers";

export const storedOfferSettings = cache(async (): Promise<OfferSettings> => {
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: OFFERS_KEY } });
    return parseOfferSettings(row?.value);
  } catch {
    return parseOfferSettings(null);
  }
});

/** Save the offers: round-tripped through the parser, so what is stored is what a reader accepts. */
export async function saveOfferSettings(input: OfferSettings): Promise<void> {
  const value = JSON.stringify(parseOfferSettings(JSON.stringify(input)));
  await prisma.platformSetting.upsert({
    where: { key: OFFERS_KEY },
    update: { value },
    create: { key: OFFERS_KEY, value },
  });
}
