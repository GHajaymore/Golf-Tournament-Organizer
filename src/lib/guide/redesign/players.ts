import type { GuideVariant } from "./index";

/**
 * THE GUIDE'S WORDS FOR THE PLAYERS ROOM (R6), drawn only while the screen is shown.
 *
 * Players is Entries, Flights, Teams and Cup teams as four tabs. It replaces nothing: today's guide names the
 * four screens one by one and stays true until the screen goes on; a person looking at the tabs reads this beside it.
 */
export const PLAYERS_GUIDE: GuideVariant = {
  screen: "players",
  replaces: [],
  sections: [
    {
      id: "playersroom",
      part: "Players",
      title: "Players: who plays, and in what groups",
      blocks: [
        {
          kind: "p",
          text: "**Players** keeps who is in the tournament and how they are divided, in four tabs along the top: **Entries**, **Flights**, **Teams** and **Cup teams**. Teams is listed only where a round is played in a team format, and Cup teams only where the tournament has a cup.",
        },
        { kind: "where", text: "Players → Entries, Flights, Teams, Cup teams" },
        {
          kind: "steps",
          items: [
            "On [[Entries]], add a player, approve an entry or move someone off the waiting list. How players get in is kept on the same tab.",
            "On [[Flights]], divide the field into flights and name them. A flight is kept here; Entries only names it.",
            "On [[Teams]], name each side and say who is on it, round by round.",
            "On [[Cup teams]], make the cup's two teams and put each player on one. The cup's scoreboard and lineups stay on the cup's own screens.",
          ],
        },
        {
          kind: "p",
          text: "Each tab can be shut by itself. Once the tournament has begun, the tab says why at the top, once, and shows the correction button where one is allowed. A refusal is said beside the button you pressed.",
        },
      ],
    },
  ],
};
