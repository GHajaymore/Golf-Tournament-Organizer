import type { GuideVariant } from "./index";

/**
 * THE GUIDE AS IT WILL BE, FOR RESULTS (R12): shown only while the screen is (`REDESIGN_GUIDE`, `screen: "results"`). It ADDS a
 * section (`replaces: []`): the lines it supersedes sit in "Finish and export", which holds much else, and at R16 they are folded
 * into one. The one verb is the machine's own label, **Make results final** (the UX Writer, 23 Nov), the same words as the
 * Dashboard's button, so the guide says what both screens say.
 */
export const RESULTS_GUIDE: GuideVariant = {
  screen: "results",
  replaces: [],
  sections: [
    {
      id: "makefinal",
      part: "Part 10",
      title: "Making the results final",
      blocks: [
        { kind: "where", text: "Afterwards → Results" },
        {
          kind: "p",
          text: "The last act of a tournament has one name everywhere: **Make results final**. It completes the tournament: the boards read Final, and the final report and the money are then final. It is the same press as the Dashboard's, and it asks first about a round nobody played. Results shows it once play is over, to the Organizer.",
        },
        {
          kind: "steps",
          items: [
            "Finish play: close each round on Score entry, or decide the final of a knockout, or the last match. When play is over Results says what ended it (for example **Every round closed**) and offers [[Make results final]].",
            "Press [[Make results final]]. It takes you to where the step asks and confirms.",
            "To correct a card afterwards, press **Reopen to correct a card** on Results, correct the card, close the round again and make the results final again.",
          ],
        },
        {
          kind: "p",
          text: "Until play is over Results says when the press will be offered, and a refusal is said where it is, with the reason. The reports, exports and the final report are unchanged: **Open the final report** and **The results so far** open the same report, and **Change** under the report's settings still chooses who sees it and who sees the amounts.",
        },
      ],
    },
  ],
};
