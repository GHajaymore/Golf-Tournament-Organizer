import { METERED_FEATURES, PLANS, type FeatureKey } from "@/lib/plans";
import { Icon } from "./Icon";

/**
 * The tag on the locked door, from whether ANY plan has the feature.
 *
 * It said "On the paid plan" unconditionally, over features that are off on
 * every plan by cost (plans.ts, "the metered three are dark on BOTH tiers").
 * A club already on Club read that it came with the plan it was paying for.
 * plan-copy.test.ts already requires these to be pitched as COMING; this is
 * the one surface that pitched them as included. When a plan turns one on,
 * the tag says so by itself — naming the first tier that has it, since "the
 * paid plan" stopped meaning one plan when the ladder went to four.
 */
export function lockedTag(feature: FeatureKey): string {
  const first = Object.values(PLANS).find((p) => p.features[feature]);
  return first ? `On ${first.name}` : "Coming soon";
}

/**
 * A feature that exists, is finished, and isn't switched on for this club yet.
 *
 * Shown in place of the control rather than instead of the whole section, and
 * shown BEFORE any work is done. The alternative — hiding it — is worse in
 * both directions: an organizer never discovers the thing they'd pay for, and
 * the one who does discover it finds out by photographing a card, waiting, and
 * being told no. A locked door you can see is a reason to upgrade; a wall is
 * not.
 *
 * The wording comes from METERED_FEATURES, the same rows the upgrade page is
 * generated from, so what is promised and what is refused cannot drift apart.
 *
 * Deliberately quiet: a dashed outline and muted text, not an ad. This sits
 * inside screens an organizer is trying to get work done on, and a feature
 * they cannot use should not out-shout the ones they can.
 */
export function LockedFeature({
  feature,
  /** Optional line about what to do instead, when the screen has an obvious
   *  fallback ("enter the scores by hand"). */
  insteadOf,
}: {
  feature: FeatureKey;
  insteadOf?: string;
}) {
  const row = METERED_FEATURES.find((f) => f.key === feature);
  if (!row) return null;

  return (
    <div
      style={{
        border: "1px dashed var(--color-divider)",
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        gap: 11,
        alignItems: "flex-start",
        background: "transparent",
      }}
    >
      <Icon name="lock-simple"
        aria-hidden
        style={{ fontSize: 17, color: "var(--color-neutral-400)", marginTop: 1, flex: "none" }}
      />
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{row.label}</span>
          <span
            className="tag"
            style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}
          >
            {lockedTag(feature)}
          </span>
        </div>
        <p className="text-muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6 }}>
          {row.benefit}
        </p>
        {insteadOf && (
          <p className="text-muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6 }}>
            {insteadOf}
          </p>
        )}
      </div>
    </div>
  );
}
