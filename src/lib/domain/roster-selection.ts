/**
 * What ticking boxes on the roster will actually do.
 *
 * Pure, and in the domain, for the reason `drawReadiness` is: the interesting
 * part is the REFUSAL, and a refusal buried in a component is a refusal no
 * test ever reads. A static render cannot tick a checkbox, so leaving this in
 * `RosterClient` would leave the whole behaviour unasserted.
 *
 * The defect it replaces: the selection bar rendered on `addable.length > 0`,
 * so ticking three members who are already in the tournament made the bar
 * VANISH — boxes tick, nothing appears, nothing on screen says why. And the
 * count it did show read `<b>{addable.length}</b> selected`, which is not what
 * was selected: tick five where two can be added and it said "2 selected",
 * which reads as the checkboxes being broken.
 *
 * So two numbers, never one. What the organizer did, and what will happen.
 */

export interface SelectionRow {
  /** Already in the tournament currently open. */
  entered: boolean;
  /** active | inactive — an inactive member is in no field. */
  status: string;
}

export interface RosterSelection {
  /** How many rows are ticked. */
  selected: number;
  /** How many of those will actually be added. */
  addable: number;
  /**
   * Why the rest will not be, in words an organizer can act on, or "" when
   * every selected row can be added.
   *
   * ONE reason at a time and the commonest first, the same way
   * `drawReadiness` does it: somebody told about the inactive ones while three
   * are already entered fixes the wrong thing and is refused again.
   */
  problem: string;
}

export function rosterSelection(chosen: SelectionRow[], eventName: string): RosterSelection {
  const selected = chosen.length;
  const addable = chosen.filter((m) => !m.entered && m.status === "active").length;
  if (selected === 0 || addable === selected) {
    return { selected, addable, problem: "" };
  }

  const alreadyIn = chosen.filter((m) => m.entered).length;
  if (alreadyIn > 0) {
    return {
      selected,
      addable,
      problem: `${alreadyIn} already in ${eventName || "this tournament"}`,
    };
  }

  // Everything left is a selected row that is neither entered nor active.
  const notActive = selected - addable;
  return {
    selected,
    addable,
    problem: `${notActive} inactive — reactivate ${notActive === 1 ? "that member" : "those members"} first`,
  };
}
