import type { GuideVariant } from "./index";
import { RELEASE_VERB } from "@/lib/domain/release-results";

/**
 * THE GUIDE AS IT WILL BE, FOR RESULTS (R12): shown only while the screen is (`REDESIGN_GUIDE`, `screen: "results"`). It ADDS a
 * section (`replaces: []`): the lines it supersedes sit in "Finish and export", which holds much else, and at R16 they are folded
 * into one. The verb is `RELEASE_VERB`, the one constant the screen draws, so the guide and the screen cannot say two things.
 */
export const RESULTS_GUIDE: GuideVariant = {
  screen: "results",
  replaces: [],
  sections: [
    {
      id: "releasing",
      part: "Part 10",
      title: "Releasing the results",
      blocks: [
        { kind: "where", text: "Afterwards → Results" },
        {
          kind: "p",
          text: `Results has one verb for the end of a tournament: **${RELEASE_VERB}**. It is the same step as Complete tournament on the Dashboard, which asks first about a round nobody played; wherever the guide says Complete or Publish the results, read ${RELEASE_VERB}.`,
        },
        {
          kind: "steps",
          items: [
            `Close every round on Score entry. When the last is closed, Results says **Every round is closed**, and offers **${RELEASE_VERB}**.`,
            `Press **${RELEASE_VERB}**. It takes you to where the step asks and confirms; the boards then read Final and the final report is the record.`,
            "To correct a card afterwards, press **Reopen to correct a card** on Results, correct the card, close the round again and release the results again.",
          ],
        },
        {
          kind: "p",
          text: "Until the last round is closed Results says when the verb will be offered, and a refusal is said where it is, with the reason. The reports, exports and the final report are unchanged: **Open the final report** and **The results so far** open the same report, and **Change** under the report's settings still chooses who sees it and who sees the amounts.",
        },
      ],
    },
  ],
};
