import type { GuideVariant } from "./index";

/**
 * THE GUIDE AS IT WILL BE, FOR TEE TIMES & DRAW (R9a): shown only while the screen is (`REDESIGN_GUIDE`,
 * `screen: "teeTimes"`). It ADDS a section (`replaces: []`) rather than replacing Part 5, which also holds
 * Flights and Teams: at R16, when the screens go on, this takes the Tee sheet and Print kit paragraphs of
 * "draw" into one place. Written for the stroke and Stableford round, the one R9a builds; the match, team,
 * league, knockout and cup rounds keep today's tee sheet, and the guide says so.
 */
export const TEE_TIMES_GUIDE: GuideVariant = {
  screen: "teeTimes",
  replaces: [],
  sections: [
  {
    id: "teetimes",
    part: "Part 5",
    title: "Tee times & draw",
    blocks: [
      { kind: "where", text: "This event → Tee times & draw" },
      {
        kind: "p",
        text: "One screen per round, for a medal or a Stableford. The round is picked at the top (each one carries its state: **Not drawn yet**, **No tee times**, **In play**, **Played**), and **This round needs** lists what is missing, each line a link to the section that puts it right. If the tournament's one button is this round's tee sheet, that section says **Needs you**.",
      },
      {
        kind: "steps",
        items: [
          "**Find a player**, beside the title: type two letters of a name and the answer drops under the box, at most three rows, such as **Ana Whitlow · Round 2 · Group 5 · 9:20 · Tee 1**. Press a row to open that round at that group. A player who is entered but on no published sheet is said so, with a link to the sheet to open; a player who withdrew or was disqualified, and a name nobody has, link to Entries. Staff see it; it reads the sheets already on the screen.",
          "**Who is in this round**: the week's list for a league, the cut when it is waiting on a tie, and **Handicaps for this round** (the figure each player plays off, changed here for one round).",
          "**The draw**: **Who plays together**, the group size, pairing requests and the groups. [[Save sheet]] keeps a draft; [[Save & publish]] then confirm [[Publish the tee sheet]].",
          "**Tee times and start**: a late entry or a reserve is put in a group with room ([[Put in group]]), and the screen says when the published sheet no longer matches the field. The start (one tee, split or shotgun), the first tee and the interval are set with the groups.",
          "**On the day**: pins and pace of play for the round.",
          "**Paper**: one [[Print…]] door opens the Print kit with this round's scorecards, signs and starting sheet ticked, and says how many printed sheets are out of date.",
        ],
      },
      {
        kind: "tip",
        text: "On a phone only the section marked **Needs you** and the draw are open; every other section is one line with its state, such as **Paper: From the saved sheet**. Press the line to open it.",
      },
      {
        kind: "p",
        text: "A match, team, league, knockout or cup round still opens today's Tee sheet (or Bracket, or Team cup); those are moved to this screen one family at a time.",
      },
    ],
  },
  ],
};
