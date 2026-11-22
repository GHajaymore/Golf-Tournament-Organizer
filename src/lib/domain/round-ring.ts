import type { RoundNeedKey, StatusRound } from "./tournament-status";

/**
 * THE NEEDS RING (R1b, ruling 15 Nov): "2 of 3 set" on a round's head, counted ONCE, here.
 *
 * The ring is about a round's OWN settings: its course, its format and its date. `asked` (what the
 * machine asks of this round, `roundNeedsOf`) is the denominator; the round's open `needs` are what
 * is missing. Pairings and tee times are never in it: they belong to the Tee times stop.
 *
 * A screen draws this and never counts `needs` itself (`the-timeline-reads-the-machine.test.ts`).
 * A missing course CARD fills the course slot, so a round with no course and a round with no card
 * both read one short.
 */

export interface RoundRing {
  /** Settings made. */
  set: number;
  /** Settings the machine asks of this round. */
  of: number;
  /** Launch is refused while one of them is open. */
  holds: boolean;
}

type RingSlot = "course" | "format" | "date";

const RING_SLOTS: readonly RingSlot[] = ["course", "format", "date"];

/** The slot a need or an ask fills: a card is the course's. Null for a need the ring does not count. */
function slotOf(k: RoundNeedKey): RingSlot | null {
  const slot = k === "card" ? "course" : k;
  return (RING_SLOTS as readonly string[]).includes(slot) ? (slot as RingSlot) : null;
}

/** Null when the round is not one that is still being set up, or the machine asks it nothing. */
export function roundRing(r: StatusRound): RoundRing | null {
  if (r.state !== "not-started") return null;
  const asked = new Set<RingSlot>();
  for (const k of r.asked) {
    const slot = slotOf(k);
    if (slot) asked.add(slot);
  }
  if (asked.size === 0) return null;
  const open = new Set<RingSlot>();
  for (const n of r.needs) {
    const slot = slotOf(n.key);
    if (slot) open.add(slot);
  }
  return {
    set: asked.size - open.size,
    of: asked.size,
    holds: r.needs.some((n) => slotOf(n.key) !== null && n.holds),
  };
}

/** The screen-reader label, and the only place these words are built: "2 of 3 set". */
export function roundRingWords(ring: RoundRing): string {
  return `${ring.set} of ${ring.of} set`;
}
