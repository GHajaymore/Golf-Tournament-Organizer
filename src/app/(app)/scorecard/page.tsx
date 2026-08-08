import { redirect } from "next/navigation";

/**
 * Printing moved into the Tee sheet.
 *
 * This screen printed one card per *flight* — seven names spread across three
 * tee times, which is not a card anyone carries to the first tee. The tee
 * sheet prints one card per foursome from the saved draw, which is the
 * artefact a group actually takes out. Two "print cards" buttons producing
 * different groupings is how an organizer prints the wrong thing on a Sunday
 * morning, so there is now one.
 *
 * The route stays so an old bookmark lands somewhere useful.
 */
export default function ScorecardPage() {
  redirect("/foursomes");
}
