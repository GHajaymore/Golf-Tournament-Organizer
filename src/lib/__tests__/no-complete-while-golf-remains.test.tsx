import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/tournament", () => ({
  setEventStatus: async () => ({ ok: true }),
  launchTournament: async () => ({ ok: true }),
  setConfigUnlocked: async () => ({ ok: true }),
}));

const { LifecycleBar } = await import("@/components/LifecycleBar");
const { statusCardOf, tournamentStatus } = await import("@/lib/domain/tournament-status");
const { tournamentJob } = await import("@/lib/domain/needs-you-now");
const { endEarlyOf, END_EARLY } = await import("@/lib/domain/lifecycle-track");
const { shortDate } = await import("@/lib/domain/round-dates");
const { facts, round, launched, playedOut } = await import("@/lib/domain/__tests__/tournament-facts-fixtures");
import type { TournamentFacts } from "@/lib/domain/tournament-status";
import type { TournamentJobFacts } from "@/lib/domain/needs-you-now";

/**
 * NO "COMPLETE" BUTTON WHILE GOLF REMAINS TO BE PLAYED — the dashboard's status card, drawn (the panel,
 * 9 Nov; the PM, 10 Nov).
 *
 * The machine's next action offers "Complete tournament" from the first card. On the Saturday night of a
 * two-day event that is one press from ending it before day 2. So the card presses the tournament's one
 * job (`tournamentJob`), and ending early is a deliberately named action behind a quiet "More":
 * "End this event early…", which asks first and names the round nobody played.
 *
 * A two-round medal is drawn at each moment, the way the dashboard composes it (`job`, `endEarly`):
 *
 *   before the first card     no Complete; More
 *   day 1, cards out          no Complete; More
 *   between rounds            no Complete; More          ← the moment the panel named
 *   play over                 Complete, the one filled button; no More
 *
 * Every name is invented.
 */

const TODAY = "2026-11-28";
const summary = { name: "zz-stepper Medal", dates: "Nov 28–29", course: "zz Links", format: "Stroke Play", overall: "Stroke play", players: 24, flights: 0, rounds: 2 };
const r1 = (o = {}) => round({ id: "r1", position: 0, ...o });
const r2 = (o = {}) => round({ id: "r2", position: 1, ...o });
const medal = (o: Partial<TournamentFacts> = {}) => facts({ startOn: "2026-11-28", endOn: "2026-11-29", confirmed: 24, groups: 0, rounds: [r1(), r2()], ...o });
const board = (o = {}): NonNullable<TournamentJobFacts["board"]> => ({ roundId: "r1", round: "Round 1", day: TODAY, closed: false, unit: "cards", started: 20, certified: 18, total: 24, ...o });

function card(f: TournamentFacts, over: Partial<TournamentJobFacts> = {}) {
  const status = tournamentStatus(f);
  const t: TournamentJobFacts = {
    eventId: "e1", name: "zz-stepper Medal", awaitingApproval: 0, entriesClose: "", nextSheet: null, board: null,
    startOn: f.startOn, endOn: f.endOn, ...over, status,
  };
  const job = tournamentJob(t, TODAY, (iso) => shortDate(iso, "en-GB"));
  return renderToStaticMarkup(
    <LifecycleBar status={statusCardOf(f, status)} job={job} endEarly={endEarlyOf(status, job)} isAdmin configUnlocked={false} summary={summary} />,
  );
}

/** A button (pressable or refused in place) whose words are "Complete tournament". */
const COMPLETE_BUTTON = /<button[^>]*>(?:(?!<\/button>)[\s\S])*Complete tournament(?:(?!<\/button>)[\s\S])*<\/button>/;
const MORE_BUTTON = /<button[^>]*aria-expanded="false"[^>]*>More/;

describe("the dashboard's card never offers Complete while golf remains to be played", () => {
  const live = {
    "before the first card": card(launched(medal())),
    "day 1, cards out": card(launched(medal({ rounds: [r1({ hasResult: true }), r2()] })), { board: board() }),
    "every card in Round 1, Round 2 to play": card(launched(medal({ rounds: [r1({ hasResult: true }), r2()] })), { board: board({ started: 24, certified: 24 }) }),
    "between rounds": card(launched(medal({ rounds: [r1({ hasResult: true, closed: true }), r2()] })), { nextSheet: { roundId: "r2", round: "Round 2", day: "2026-11-29", published: true } }),
  };

  for (const [moment, html] of Object.entries(live)) {
    it(`${moment}: no Complete button, and "More" holds ending early, folded`, () => {
      expect(html, `a Complete button ${moment}`).not.toMatch(COMPLETE_BUTTON);
      expect(html).toMatch(MORE_BUTTON);
      // Folded until pressed: the early action is not on screen until the organizer asks for it.
      expect(html).not.toContain(END_EARLY);
    });
  }

  it("play over: Complete is the card's one filled button, and there is nothing to end early", () => {
    const html = card(playedOut(medal()));
    expect(html).toMatch(/<button[^>]*class="btn btn-primary"[^>]*>[\s\S]*?Complete tournament/);
    expect(html).not.toMatch(MORE_BUTTON);
  });

  it("CONTROL: the patterns see a Complete button and a More button when they are there", () => {
    expect('<button type="button" class="btn btn-secondary"> Complete tournament</button>').toMatch(COMPLETE_BUTTON);
    expect('<button type="button" aria-disabled="true" aria-describedby="x">Complete tournament</button>').toMatch(COMPLETE_BUTTON);
    expect('<button type="button" class="btn btn-secondary" aria-expanded="false" aria-controls="y">More <svg></svg></button>').toMatch(MORE_BUTTON);
    // And a card handed no job (the old contract) still draws the machine's Complete mid-play.
    const old = renderToStaticMarkup(
      <LifecycleBar status={statusCardOf(launched(medal({ rounds: [r1({ hasResult: true }), r2()] })))} isAdmin configUnlocked={false} summary={summary} />,
    );
    expect(old).toMatch(COMPLETE_BUTTON);
  });
});
