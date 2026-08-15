"use client";

/**
 * A person you can tap: in the pot, or the one who won it.
 *
 * Deliberately NOT a primary button when selected. A field of twenty solid
 * accent buttons reads as twenty primary actions competing with each other and
 * with the real one on the screen — it shouts over the club's colour instead
 * of sitting in it. Selected is a TINT of the same colour with a border and a
 * mark, which is quieter, still unmistakable, and leaves the accent meaning
 * "the thing to press".
 *
 * Every colour here is a theme token, so it is the club's configured palette
 * that decides: `--color-accent` and `--color-accent-2` come from the
 * organization's themeKey / themeSecondaryKey (or its custom hex) via
 * themeCss. A club that picks Signal green or Violet gets these chips in it,
 * and nothing in this file has to know that happened.
 *
 * The two tones mean two different things, using the same pairing the
 * leaderboard already uses: the accent for money IN (who staked), the second
 * colour for money OUT (who won).
 *
 * Shared by the organizer's side-bet panel and the player's money screen — one
 * chip, so the two cannot drift into looking like different products.
 */
export function PersonChip({
  name,
  on,
  tone = "in",
  disabled,
  onClick,
}: {
  name: string;
  on: boolean;
  tone?: "in" | "won";
  disabled?: boolean;
  onClick: () => void;
}) {
  const colour = tone === "won" ? "var(--color-accent-2)" : "var(--color-accent)";
  return (
    <button
      type="button"
      className="touch-target"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 40,
        padding: "0 12px",
        borderRadius: 999,
        cursor: disabled ? "default" : "pointer",
        fontSize: 12.5,
        fontWeight: on ? 600 : 500,
        color: "var(--color-text)",
        background: on ? `color-mix(in srgb, ${colour} 16%, transparent)` : "var(--color-surface)",
        border: `1px solid ${on ? colour : "var(--color-divider)"}`,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <i
        className={`ph ${on ? (tone === "won" ? "ph-trophy" : "ph-check-circle") : "ph-circle"}`}
        style={{ fontSize: 14, color: on ? colour : "var(--color-neutral-500)" }}
        aria-hidden
      />
      {name}
    </button>
  );
}
