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
          text: "Closing a round and its scoring window are on Score entry now, under the round you are scoring, and no longer on Rounds & formats. Wherever the guide says to close a round on Rounds & formats, read Score entry. The **Close Round n** button on What's next, the one on the Dashboard's status card, and the Dashboard's **Every card is in** card (which no longer closes the round in place) open Score entry at that round. Every round has it, a side's round and a cup session as much as a medal. On a phone the section is one line (**Close Round 2 · 3 cards to come**); it is open, and marked **Needs you**, while a card is still to come.",
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
          text: "Tick **This round is finished** to tell the board the round is over; the ⓘ beside it says what that does. If a card is not yet approved (or signed, where players sign), it asks first and names whose: **Close anyway** or **Keep it open**. If nobody has played a hole in the round yet, it asks first as well (“Nobody has played a hole in Round 2 yet. Close it anyway?”): on a stroke board closing takes every player's place away, so if play was rained off, press **Keep it open** and change the round's day under **Played on** on Rounds & formats. A match conceded before play counts as a result and is not asked. A disputed card stops the close until you settle it. Untick it to take a late card; nothing is lost either way.",
        },
        { kind: "h", text: "A round of matches" },
        {
          kind: "p",
          text: "A round played as matches (a cup's four-balls, tapped or on cards) counts matches, not cards or places. The section's line reads **1 of 2 matches finished**, then **All 2 matches finished**, then **Round 2 is closed**, and a match is finished when it is decided on the holes or conceded. The line beside the tick says **Tell the board this round's matches are over**, and the ⓘ adds that a match that isn't finished keeps the holes it has and the committee decides it, so leave the tick alone while matches are still on the course. A four-ball medal (a Stroke Play Round) keeps the card words.",
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
