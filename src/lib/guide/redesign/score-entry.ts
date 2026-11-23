import type { GuideVariant } from "./index";

/**
 * THE GUIDE AS IT WILL BE, FOR SCORE ENTRY (R12): shown only while the screen is (`REDESIGN_GUIDE`, `screen: "scoreEntry"`). It ADDS
 * a section (`replaces: []`) as Tee times & draw does, because the lines it supersedes sit in "On the day" and "Finish and export",
 * which hold much else; at R16, when the screens go on, they are folded into one place. It says so itself, so the old lines are
 * never read as the truth while this screen is shown.
 */
export const SCORE_ENTRY_GUIDE: GuideVariant = {
  screen: "scoreEntry",
  replaces: [],
  sections: [
    {
      id: "scoreentry",
      part: "Part 7",
      title: "Closing a round, on Score entry",
      blocks: [
        { kind: "where", text: "On the day → Score entry → Close Round n" },
        {
          kind: "p",
          text: "Closing a round and its scoring window are on Score entry now, under the round you are scoring, and no longer on Rounds & formats. Wherever the guide says to close a round on Rounds & formats, read Score entry. The **Close Round n** button on What's next still lands on Rounds & formats for now: open Score entry from the menu to close the round. Every round has it, a side's round and a cup session as much as a medal. On a phone the section is one line (**Close Round 2 · 3 cards to come**); it is open, and marked **Needs you**, while a card is still to come.",
        },
        { kind: "h", text: "Cards still to come" },
        {
          kind: "p",
          text: "For a stroke or Stableford round the section lists every player the round is still owed a card from: in the round's field (after a cut, the players it left in), not marked out for the week, and with no hole on any card. Each name says **No card returned: Round 2**, which is what closing the round will record, and has one other answer, **Withdrew**.",
        },
        {
          kind: "steps",
          items: [
            "Leave the name as it is to close with **No card returned**. On a stroke board the player is then shown without a place, under the field, and the board says why: no card was returned for the round, and the committee has closed it (Rule 3.3b). A points board keeps the player and counts the points the missed round was worth.",
            "Press **Withdrew** beside a name, then confirm, for somebody who has left or will not play again (somebody away only this week is marked out for the week on Players, and is not listed here). It is the withdrawal Players already has: the player is out of the rest of the event as well, and is listed **WD** over the cards they returned, or **DNS** if they never began. **Put back** on Players undoes it.",
          ],
        },
        { kind: "h", text: "Is this round over?" },
        {
          kind: "p",
          text: "Tick **This round is finished** to tell the board the round is over; the ⓘ beside it says what that does. If a card is not yet approved (or signed, where players sign), it asks first and names whose: **Close anyway** or **Keep it open**. A disputed card stops the close until you settle it. Untick it to take a late card; nothing is lost either way.",
        },
        { kind: "h", text: "Scoring window" },
        {
          kind: "p",
          text: "**Follow the date**, **Close Round n now** or **Keep it open**: the window follows the round's play-by date, in the club's own day, unless you say otherwise. It is the club's day that counts, not the day on the phone you are holding.",
        },
        { kind: "h", text: "Where it was played" },
        {
          kind: "p",
          text: "**Played at** is asked here only for an event with no fixed course, where each pairing arranges its own venue and whoever enters the card names it. For a fixed course the venue is set once on Rounds & formats; the round's **Tees** stay here, and a round with no card yet is still told so.",
        },
        {
          kind: "tip",
          text: "Rounds & formats no longer draws **Is this round over?** or the scoring window while Score entry is shown; each is drawn in one place.",
        },
      ],
    },
  ],
};
