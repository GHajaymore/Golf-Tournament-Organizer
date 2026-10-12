/**
 * Who a message is actually going to, once two controls have both had a say.
 *
 * The compose card asks one question — "Who is this for?" — with TWO selects
 * under it: a group, and "…or one person". The person wins, and nothing on the
 * screen said so. Worse, picking a person set the group select's value to `""`,
 * which is not one of its options, so the select rendered BLANK: the card asked
 * a question and then showed no answer while a real one was in force.
 *
 * Pure and in the domain for the reason `rosterSelection` is — every piece of
 * state in that panel is local, so a static render only ever sees the panel's
 * opening position and the interesting branches are unreachable. A resolution
 * no test can read is a resolution nobody checks.
 */

export interface MessageAudience {
  /** The audience, for emphasis in the sentence. */
  name: string;
  /**
   * The sentence the card prints, in two parts: the words before the audience,
   * and the audience as those words need it written.
   *
   * The card printed "Going to everyone in " and then the group's label, which
   * is right for a group with a NAME ("everyone in Flight A") and wrong for
   * the four that are a description of who is in them: "Going to everyone in
   * Everyone at the club", "…everyone in Players only" (read off the screen,
   * 2026-10-13 — and "Everyone at the club" is the one the picker opens on).
   * A label that already says who it is, is the sentence.
   */
  lead: string;
  said: string;
  /** The rest of the sentence after the name. */
  detail: string;
  /** One person rather than a group. */
  direct: boolean;
  /**
   * Why a ticked "also send this as a text" will not produce one, or "".
   *
   * `canText` is false the moment a person is picked, which HIDES the whole
   * checkbox — tick still set — and quietly reverts the button from
   * "Send + text" to "Send". Somebody does not get a message they were
   * promised, so it is said rather than left to be noticed.
   */
  textNote: string;
}

const NO_TEXT_TO_ONE =
  "A text goes to a group, not to one person, so this one goes in the app only.";

export function messageAudience(input: {
  /** Empty when no single person is picked. */
  personName: string;
  /** The chosen group's label, e.g. "Your group — Group 1". */
  scopeLabel: string;
  /** Whether "also send this as a text" is ticked. */
  alsoText: boolean;
}): MessageAudience {
  const person = input.personName.trim();
  if (person) {
    return {
      name: person,
      lead: "Going to ",
      said: person,
      detail: "only — a direct message nobody else sees.",
      direct: true,
      textNote: input.alsoText ? NO_TEXT_TO_ONE : "",
    };
  }
  // A group with no label at all should not render "everyone in ." — it
  // says nothing rather than saying something false.
  const name = input.scopeLabel.trim() || "this tournament";
  // "Everyone at the club", "Everyone in this tournament", "Players only", "Organizers only",
  // "Your flight", "Your group — Group 1": each says who it is. Anything else is a name.
  const describesItself = /^(everyone|players only|organi[sz]ers only|your)(\s|$)/i.test(name);
  return {
    name,
    lead: describesItself ? "Going to " : "Going to everyone in ",
    said: describesItself ? name[0].toLowerCase() + name.slice(1) : name,
    detail: "",
    direct: false,
    textNote: "",
  };
}
