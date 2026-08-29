/**
 * Who gets a chip on a collapsed expense row, and in what state.
 *
 * Pulled out of the component deliberately. The rule branches on the size of
 * the field, and a branch that only exists in JSX is a branch no test can
 * reach — which is exactly how the first version of this shipped rendering
 * NOTHING on a 33-player event with typecheck and 2084 tests green. The
 * appearance still needs an eye; the SELECTION does not, and the three things
 * that must never stop being true are asserted rather than trusted:
 *
 *   1. every share with a real weight gets a chip;
 *   2. whoever paid gets a chip, even when they are not on the bill at all;
 *   3. the row never has more chips than the field has people.
 */

/** Above this many chips the row stops being a summary and becomes a wall. */
export const SHARE_FIELD_MAX = 12;

export type ChipState =
  /** In the split, owing a real share. */
  | "in"
  /** On the line at a weight of zero: present, owing nothing. */
  | "nil"
  /** Never on this line at all. */
  | "off";

export interface Chip {
  playerId: string;
  name: string;
  state: ChipState;
  /** Laid money out for this bill, which can be true in any state. */
  payer: boolean;
}

export interface ShareLike {
  playerId: string;
  weight: number;
  exactCents?: number | null;
}

/**
 * The chips for one row, or an empty list meaning "show none of this".
 *
 * WHICH people are shown depends on the size of the field, because the two
 * cases ask different questions.
 *
 * A SMALL field — a fourball, a society trip — shows everyone, with the
 * absentees faded. There the absence IS the argument: two of eight missing
 * from the flights line is what makes weighted splitting legible at a glance.
 *
 * A BIG field shows only the people the bill touches. Nobody is asking which
 * twenty-nine members did not eat dinner, and thirty-three chips with
 * twenty-nine faded is not information, it is a wall with the answer
 * somewhere in it.
 *
 * "Touches" includes two people it would be easy to drop, and dropping either
 * would remove the whole point of the row:
 *
 *   - a share at weight ZERO. They are on the bill owing nothing, which is a
 *     different fact from never having been on it, and it is the fact the
 *     expanded row already bothers to print ("not on this bill").
 *   - the PAYER, who need not be on the bill at all — one player fronting a
 *     guest's green fee, or putting the bar tab on their card without
 *     drinking. Filtering by "has a share" loses exactly the chip that must
 *     always be there.
 */
export function shareField(
  field: ReadonlyArray<{ id: string; name: string }>,
  shares: ReadonlyArray<ShareLike>,
  payerIds: ReadonlyArray<string>,
  max: number = SHARE_FIELD_MAX,
): Chip[] {
  const byId = new Map(shares.map((s) => [s.playerId, s]));
  const payers = new Set(payerIds.filter(Boolean));

  const touches = (id: string) => byId.has(id) || payers.has(id);
  const shown = field.length <= max ? field : field.filter((p) => touches(p.id));

  if (shown.length === 0 || shown.length > max) return [];

  return shown.map((p) => {
    const share = byId.get(p.id);
    const state: ChipState = !share
      ? "off"
      : share.weight === 0 && (share.exactCents ?? 0) === 0
        ? "nil"
        : "in";
    return { playerId: p.id, name: p.name, state, payer: payers.has(p.id) };
  });
}

/** "A. Rourke" → "AR"; "Sam" → "SA". Two characters, so the row stays even. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
