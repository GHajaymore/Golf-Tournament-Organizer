/**
 * Whether pairings can be drawn, and if not, what to do about it.
 *
 * The refusal at the POINT OF CONSEQUENCE. `orgSetupState` deliberately does
 * not gate anything — an organizer creates the tournament the day the date is
 * confirmed and loads the roster over the following fortnight, so blocking
 * that turns a normal sequence into a blocked one. The honest other half of not
 * gating is that where an empty step genuinely cannot work, the control that
 * cannot work says so, at the moment it is reached, and links to the fix.
 *
 * What this replaces is worse than a gate: the draw button was
 * `disabled={pending || players.length === 0 || locked}` and said NOTHING. A
 * disabled control with no reason is the exact complaint that was raised about
 * Rounds & formats — the organizer sees a dead button and cannot tell whether
 * the app is broken, whether they lack permission, or what they are supposed to
 * do next.
 *
 * A `title` tooltip is not the fix either. It never appears on a touch device,
 * it is not announced, and it cannot hold a link. The reason has to be on the
 * page.
 *
 * Modelled on `resolveThirdPlace` and `resolveSingleMatch`: resolve, or explain
 * in words why not, and never guess.
 */

export interface DrawBlock {
  /** What is stopping the draw, in words an organizer would use. */
  problem: string;
  /** Where to go and fix it. */
  href: string;
  /** The link's text, which must read as the thing to do. */
  linkLabel: string;
}

export interface DrawReadinessInput {
  /** Confirmed players in the field. Not the club roster — see below. */
  fieldSize: number;
  /** Setup is frozen because the tournament is live or completed. */
  locked: boolean;
}

/**
 * Null when the draw can go ahead, otherwise the one thing to fix first.
 *
 * ONE reason at a time, the most fundamental first. An organizer told three
 * things at once fixes none of them, and a locked tournament cannot act on
 * "add some players" anyway — the unlock has to come first or the next click
 * refuses again for a new reason.
 *
 * The empty-field link goes to Registration & field rather than to the club
 * roster, and the difference matters. The roster is who belongs to the club;
 * the FIELD is who is playing this tournament, and it is the field a draw is
 * made from. Sending somebody to the roster to fix an empty field is sending
 * them one screen short of the thing they need to do — though the roster is
 * where they will pull the names from, which is why the wording says so.
 */
export function drawReadiness(input: DrawReadinessInput): DrawBlock | null {
  if (input.locked) {
    return {
      problem:
        "Setup is locked because this tournament has started. Unlock it to redraw — any scores already entered stay as they are.",
      href: "/event",
      linkLabel: "Unlock the tournament",
    };
  }
  if (input.fieldSize <= 0) {
    return {
      problem: "Pairings cannot be drawn from an empty field — nobody is entered yet.",
      href: "/registration",
      linkLabel: "Add players to the field",
    };
  }
  return null;
}
