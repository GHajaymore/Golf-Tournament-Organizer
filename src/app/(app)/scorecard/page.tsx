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
 *
 * ON THE PRINT CONTROL, not merely on the page. This redirected to the top of
 * `/foursomes`, which is headed "Tee sheet" and opens on "Re-draw this sheet"
 * — so somebody who asked for scorecards got a pairing editor and had to
 * scroll past it to find the button. Ajay, 2026-09-22, about the same link on
 * Reports: "it takes me to teesheet and not the actual scorecards".
 *
 * The anchor is `TeeSheetPrint`'s own, and it renders nothing at all until a
 * sheet is saved — in which case the hash matches no element and the browser
 * simply leaves you at the top of the Tee sheet, which is exactly where
 * somebody with no draw yet needs to be.
 */
export default function ScorecardPage() {
  redirect("/foursomes#print-scorecards");
}
