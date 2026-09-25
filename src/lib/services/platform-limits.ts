import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import {
  parseLimitOverrides,
  limitOverrides,
  type LimitKey,
  type LimitOverrides,
  type PlanKey,
} from "@/lib/plans";

/**
 * WHERE THE OWNER'S LIMIT OVERRIDES AND THE ENFORCEMENT SWITCH ARE KEPT.
 *
 * The twin of `platform-pricing.ts`. `plans.ts` designed for this: every limit
 * reader takes `overrides` as a parameter so the source can change without the
 * arithmetic changing. Until now the only source was the `TOURNEYHQ_LIMITS`
 * environment value; this adds the owner console as a second, higher-priority
 * source — a `PlatformSetting` row the owner edits on screen.
 *
 * Order: the stored row wins whenever it is present (the console is the
 * authoritative source once used), else the environment value, else each
 * plan's own default. A corrupt row parses to "enforce off, no caps", which is
 * the SAFE direction — nobody is ever locked out by a bad settings value.
 */

const LIMITS_KEY = "limits";

/**
 * The limit overrides in force, resolved once per request.
 *
 * Memoised with React's `cache` for the same reason pricing is: the owner
 * console reads it while it renders the tiers, and a single gate check within a
 * request should hit the row once. Outside a render it is simply the function.
 */
export const storedLimitOverrides = cache(async (): Promise<LimitOverrides> => {
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: LIMITS_KEY } });
    // Once the owner has saved, their row is authoritative — the enforce flag
    // included, so an explicit "enforcement off, no caps" is honoured rather
    // than falling through to a possibly-on environment value. A malformed
    // value parses to the same safe default, which fails OFF by design.
    if (row) return parseLimitOverrides(row.value);
  } catch {
    // A database blip must never start refusing entries. Fall back to env,
    // which is off unless an operator set TOURNEYHQ_LIMITS.
  }
  return limitOverrides();
});

/**
 * Save the owner's enforcement switch and per-tier limit overrides — one
 * validated JSON blob in one row.
 *
 * Serialised through `parseLimitOverrides` so exactly the shape the readers
 * expect is stored and nothing else: an unknown plan key, a negative cap or a
 * non-number is dropped here rather than written and tripped over at an entry
 * gate later. A limit cleared back to a plan's default is stored as the absence
 * of an override for that limit, so "reset to default" just means "send no
 * number"; an explicit `null` is kept, meaning unlimited.
 */
export async function saveLimitOverride(input: {
  enforce: boolean;
  plans: Partial<Record<PlanKey, Partial<Record<LimitKey, number | null>>>>;
}): Promise<void> {
  const clean = parseLimitOverrides(JSON.stringify(input));
  const value = JSON.stringify(clean);
  await prisma.platformSetting.upsert({
    where: { key: LIMITS_KEY },
    update: { value },
    create: { key: LIMITS_KEY, value },
  });
}
