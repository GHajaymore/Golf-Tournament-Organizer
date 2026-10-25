import { Icon } from "./Icon";
import { HOLE_SYNC_WORDS, type HoleSync } from "@/lib/domain/pending-card";

/**
 * WHERE A HOLE'S SCORE IS, DRAWN — the honest card (2026-10-25).
 *
 * Two pieces, one vocabulary (`HOLE_SYNC_WORDS`), used by every card a player
 * keeps score on: the medal card, the group card, the round-code card and both
 * match cards.
 *
 *   `HoleSyncMark`   a quiet mark in the corner of a hole on the strip — a ring
 *                    for "On your phone", a tick for "Sent", a solid dot for
 *                    "Not sent". Inside the chip, so a 320px strip is no wider.
 *   `HoleSyncWords`  the same thing in words, beside the hole being played.
 *
 * Drawn in the text colour, not a status colour: the mark is read in sunlight
 * at arm's length, and `--color-text` is the one token every theme holds well
 * past 7:1 on its own ground. Ring and tick differ by SHAPE, so nobody has to
 * tell two tints apart outdoors. Only "Not sent" takes a colour, the warning
 * token, measured at 7.35:1 on the dark surface.
 *
 * Nothing here decides anything. The state comes from the queue
 * (`usePendingCard().holes`), which works it out from the card it holds to send
 * and what the server read back — so a hole cannot be drawn "Sent" while the
 * sender still holds it.
 */
export function HoleSyncMark({ sync }: { sync: HoleSync }) {
  if (sync === "none") return null;
  // DRAWN, NOT LETTERED: three shapes in borders, so no glyph is set below the
  // type floor (`brand-consistency`, `console-type-floor`) and nothing depends
  // on a font having arrived on one bar of signal.
  const common = { position: "absolute" as const, pointerEvents: "none" as const, boxSizing: "border-box" as const };
  if (sync === "phone") {
    // A ring: something is here, not yet there.
    return (
      <span
        aria-hidden="true"
        data-hole-sync-mark="phone"
        style={{ ...common, top: 3, right: 3, width: 8, height: 8, borderRadius: "50%", border: "1.5px solid var(--color-text)" }}
      />
    );
  }
  if (sync === "sent") {
    // A tick: done.
    return (
      <span
        aria-hidden="true"
        data-hole-sync-mark="sent"
        style={{
          ...common,
          top: 2,
          right: 5,
          width: 5,
          height: 9,
          borderRight: "2px solid var(--color-text)",
          borderBottom: "2px solid var(--color-text)",
          transform: "rotate(45deg)",
        }}
      />
    );
  }
  // A solid dot in the warning colour: the one mark that asks to be looked at.
  return (
    <span
      aria-hidden="true"
      data-hole-sync-mark="refused"
      style={{ ...common, top: 3, right: 3, width: 8, height: 8, borderRadius: "50%", background: "var(--color-warning)" }}
    />
  );
}

/** The words a screen reader adds to a hole on the strip. */
export function holeSyncSaid(sync: HoleSync | undefined): string {
  return sync && sync !== "none" ? `, ${HOLE_SYNC_WORDS[sync].toLowerCase()}` : "";
}

/**
 * The hole being played, in words — and for a refusal, the server's own
 * sentence and what to do, said where the press was.
 */
export function HoleSyncWords({ sync, refusal = "" }: { sync: HoleSync | undefined; refusal?: string }) {
  if (!sync || sync === "none") return null;
  const refused = sync === "refused";
  return (
    <p
      data-hole-sync={sync}
      style={{
        margin: "8px 0 0",
        fontSize: 14,
        lineHeight: 1.45,
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        color: refused ? "var(--color-warning)" : "var(--color-text)",
        fontWeight: refused ? 600 : 500,
      }}
    >
      <Icon name={sync === "sent" ? "check" : refused ? "warning-circle" : "cloud-arrow-up"} style={{ flex: "none" }} />
      <span style={{ minWidth: 0 }}>
        {HOLE_SYNC_WORDS[sync]}
        {sync === "phone" && <span style={{ fontWeight: 400 }}> — it sends by itself</span>}
        {refused && (
          <span style={{ fontWeight: 400 }}>
            {" — "}
            {refusal ? `${refusal.replace(/[.!?]?$/, ".")} ` : "the club’s system would not take this card. "}
            Your score is kept on this phone. Show this card to the committee.
          </span>
        )}
      </span>
    </p>
  );
}
