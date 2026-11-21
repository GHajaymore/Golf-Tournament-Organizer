import type { ScreenKey } from "@/lib/domain/console-merges";
import type { GuideSection } from "@/lib/guide-steps";

/**
 * THE GUIDE'S REDESIGN VARIANTS (R1b): each redesigned screen's PR adds ONE file beside this one,
 * holding the guide's words for that screen as it will be, and one line in `REDESIGN_GUIDE`.
 * `guide-steps.ts` itself changes once, at R16, when the screens go on and the variants become the guide.
 *
 * A variant is drawn only while its screen is shown (`mergesShown`): a preview shows the guide that
 * matches it, and everybody else reads today's guide, unchanged. `replaces` names the base sections
 * (`GuideSection.id`) the variant takes the place of; `[]` adds its sections at the end.
 *
 * STARTS EMPTY: with no variant the guide is exactly `GUIDE_STEPS`, for every set of shown screens.
 */

export interface GuideVariant {
  screen: ScreenKey;
  replaces: string[];
  sections: GuideSection[];
}

export const REDESIGN_GUIDE: readonly GuideVariant[] = [];

/**
 * The guide as the screens now shown describe themselves. Each shown screen's variant takes the place
 * of the first section it replaces, and the other sections it replaces are dropped; a variant that
 * replaces nothing is added after the last section. Order is the registry's, never the set's.
 */
export function guideFor(
  base: GuideSection[],
  shown: readonly ScreenKey[],
  registry: readonly GuideVariant[] = REDESIGN_GUIDE,
): GuideSection[] {
  const active = registry.filter((v) => shown.includes(v.screen));
  if (active.length === 0) return base;
  let out = base;
  for (const v of active) {
    const at = out.findIndex((s) => v.replaces.includes(s.id));
    const rest = out.filter((s) => !v.replaces.includes(s.id));
    if (at === -1) {
      out = [...rest, ...v.sections];
    } else {
      // `at` is the FIRST replaced section, so every section before it is kept and still sits at 0..at.
      out = [...rest.slice(0, at), ...v.sections, ...rest.slice(at)];
    }
  }
  return out;
}
