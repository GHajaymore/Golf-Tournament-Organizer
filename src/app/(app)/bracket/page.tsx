import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { isFinished } from "@/lib/domain/lifecycle-state";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { canSeeLeaderboard } from "@/lib/tournament-settings";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { bracketScreenName } from "@/lib/domain/bracket-name";
import { stageTypeInfo } from "@/lib/stage-types";
import { BracketClient } from "@/components/BracketClient";
import { BracketModePicker } from "@/components/BracketModePicker";
import { BracketFlights } from "@/components/BracketFlights";
import { FLIGHT_CRITERIA, proposeShapes } from "@/lib/domain/bracket-flights";
import { indexLabel } from "@/lib/domain/handicap-label";
import { QualificationPanel } from "@/components/QualificationPanel";
import { isBracketMode, drawBrackets, type BracketMode } from "@/lib/domain";
import { plateEntrants, byeLine } from "@/lib/domain/bracket";
import { hasKnockoutStage, isStraightKnockout, isKnockoutRound } from "@/lib/stage-types";
import { BracketReports, type BracketReportRow } from "@/components/BracketReports";
import { bracketDraws, openTieReport } from "@/lib/domain/my-tie";
import { flightLabel } from "@/lib/domain/flight-label";
import { qualifyingCutoffText } from "@/lib/domain/cut";
import { toParText } from "@/lib/domain/stroke";
import { pts } from "@/lib/format";
import { resolveThirdPlace } from "@/lib/domain/third-place";
import { drawsSeeded, qualifyingPlayed as qualifyingWasPlayed } from "@/lib/domain/draw-seeding";
import { parsePlayBy, roundPlayBy, toPlay, fromFinal } from "@/lib/domain/knockout-play-by";
import { formattingForEvent } from "@/lib/services/organization";
import { KnockoutToPlay } from "@/components/KnockoutToPlay";
import { KnockoutPlayByForm } from "@/components/KnockoutPlayByForm";

export const metadata = screenMetadata("/bracket");

export default async function BracketPage() {
  const session = await requireScreen("bracket");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  // Seeding is a direct read on the standings, so a blind event hides the
  // bracket from players for the same reason it hides the leaderboard.
  if (!canSeeLeaderboard(settingsOf(state.event), session.viewRole)) redirect("/dashboard");

  /**
   * NO KNOCKOUT ROUND, NO BRACKET — AND THE SCREEN SAYS SO.
   *
   * The menu has withheld this screen from such a tournament since it existed
   * (`nav.ts`), but a typed address or an old bookmark still opened it — and
   * it drew one: a 36-hole stroke-play championship got "Seeded from
   * qualification", an empty Final, and "0 players qualify for the knockout
   * round" about a round it does not have (found by the control crawler,
   * 2026-10-10).
   *
   * It says what is missing and where to add it, the way the Team cup screen
   * does for a tournament with no sessions. For one night it sent the visitor
   * to the dashboard instead; a bookmark that lands somewhere else without a
   * word is its own small confusion, and the layout sweeps — which measure
   * every route for a heading, its icons and sideways scroll — had nothing
   * left to measure here.
   */
  if (!hasKnockoutStage(state.stages)) {
    const staff = session.viewRole === "admin" || session.viewRole === "assistant";
    return (
      <>
        <div style={{ marginBottom: 20 }}>
          <div className="page-kicker">Manage</div>
          <h1 className="page-title">{bracketScreenName(!staff)}</h1>
        </div>
        <div className="card elev-sm" style={{ maxWidth: "62ch" }}>
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            This tournament has no knockout round, so there is no bracket to draw.
            {staff ? (
              <>
                {" "}Add a round of type <strong>{stageTypeInfo("Bracket Stage").label}</strong> on{" "}
                <Link href="/stages">Rounds &amp; formats</Link> and the draw appears here.
              </>
            ) : (
              " Its results are on the leaderboard."
            )}
          </p>
        </div>
      </>
    );
  }

  const bw = await prisma.bracketWinner.findMany({ where: { eventId: session.eventId } });
  const results: Record<string, string> = {};
  for (const w of bw) if (w.result) results[w.key] = w.result;
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";
  // The ARRANGEMENT redraws who plays whom, and `setBracketMode` is organizer
  // only — offered to an assistant it was a Change button that always failed.
  // Entering results stays open to staff.
  const isAdmin = session.viewRole === "admin";

  // Results the players in a tie have reported, for staff to approve. Named
  // off the draw on screen, so the list and the bracket cannot disagree about
  // who is in the tie; a report for a tie the draw no longer holds is left out
  // here and set aside by `approveBracketReport` if anybody reaches it.
  const draws = bracketDraws(state.brackets);
  const reports: BracketReportRow[] = isStaff
    ? (await prisma.bracketReport.findMany({ where: { eventId: session.eventId }, orderBy: { createdAt: "asc" } }))
        .map((r) => {
          const open = openTieReport(draws, r);
          return open ? { key: r.key, ...open, result: r.result, reportedBy: r.reportedBy } : null;
        })
        .filter((r): r is BracketReportRow => r !== null)
    : [];

  const mode: BracketMode = isBracketMode(state.event.bracketMode) ? state.event.bracketMode : "split";
  const { mainLabel, secondLabel } = drawBrackets([], mode);
  /**
   * A STRAIGHT KNOCKOUT: the bracket is the first round, so there is no
   * qualification to audit — `loadEventState` puts every entrant in the draw.
   * Said once, plainly, instead of a qualification panel reading "Top 2/flight"
   * over "8 players qualify" with no round anybody qualified in.
   */
  const straight = isStraightKnockout(state.stages);
  /**
   * WHETHER ANYBODY HAS PLAYED THE ROUNDS THAT FEED THE DRAW (2026-10-16).
   * Before then the draw is the entry order, and the screen said "Seeded from
   * qualification" over a cutoff of 0 points — read as the qualifying being
   * over. Walked on a two-round-robin championship with nothing played.
   */
  const firstKnockout = state.stages.findIndex((s) => isKnockoutRound(s.type));
  const qualifyingPlayed = qualifyingWasPlayed(state.stages, state.roundsWithResults);
  /**
   * THE PLAY-OFF FOR THIRD, ON THE SCREEN THAT SHOWS THE DRAW (2026-10-16).
   * It is switched on and made on the knockout's own card on Rounds & formats,
   * and played as a match; the draw said nothing about it at all.
   */
  const koStage = firstKnockout >= 0 ? state.stages[firstKnockout] : null;
  const third =
    koStage?.thirdPlace && !state.brackets.draws
      ? {
          ...resolveThirdPlace(state.brackets.winners),
          made: (await prisma.match.count({ where: { eventId: session.eventId, stageId: koStage.id, round: 0 } })) > 0,
        }
      : null;
  /**
   * THE PLAY-BY DATES, AND "TO PLAY" (the panel, 2026-10-23): each round's date
   * from the knockout's own round, worded the club's way and judged "Overdue"
   * against the club's day; and the list the secretary opens on.
   */
  const { locale } = await formattingForEvent(session.eventId);
  const playByDates = parsePlayBy(koStage?.knockoutPlayBy);
  const playBy = Object.fromEntries(draws.map((d) => [d.view.kind, roundPlayBy(d.view, playByDates, state.today, locale)]));
  const ready = toPlay(draws, playByDates, state.today, locale);
  const longest = draws.reduce((a, d) => (d.view.rounds.length > a.rounds.length ? d.view : a), draws[0]?.view ?? state.brackets.winners);
  const toPlayPanel =
    isStaff && koStage ? (
      <>
        <KnockoutToPlay
          waiting={ready.waiting}
          groups={ready.rounds.map((g) => ({
            draw: draws.length > 1 ? g.draw : "",
            round: g.round,
            playBy: g.playBy,
            ties: g.ties.map((m) => ({ key: m.key, a: { id: m.a.playerId!, name: m.a.name }, b: { id: m.b.playerId!, name: m.b.name } })),
          }))}
        />
        <KnockoutPlayByForm
          stageId={koStage.id}
          rounds={longest.rounds.map((r, i) => ({ fromFinal: fromFinal(longest, i), label: r.label }))}
          dates={playByDates}
        />
      </>
    ) : undefined;
  /** Every qualifier's place in the qualifying order — the seed a player keeps in any draw. */
  const seeds = Object.fromEntries(state.qualifiers.map((q, i) => [q.id, i + 1]));

  /**
   * The qualification audit, which used to be its own screen.
   *
   * `/bracket`'s own subtitle has always read "Seeded from qualification", the
   * two nav items were gated on the same condition so they appeared and
   * vanished together, and both showed the same four people — one as "who goes
   * through", the other as "who they play". Two entries that are never
   * separately available are one screen.
   *
   * Staff only, because that is what it already was: `roles.ts` grants
   * `qualification` to admin and assistant and `bracket` to players as well.
   * Merging must not hand a player the preview — including the per-flight
   * "Eliminated" tag beside their own name — that they could not reach before.
   *
   * The numbers come from `drawBrackets`, the same function the real draw
   * uses. The old screen hardcoded a half-and-half split and never read
   * `bracketMode`, so it described a draw the tournament was not going to
   * make; that fix is kept rather than re-derived.
   */
  const qualification = isStaff && !straight
    ? (() => {
        const draw = drawBrackets(state.qualifiers, mode);
        const flightOf = new Map(
          state.groups.flatMap((g, i) =>
            state.confirmed.filter((p) => p.groupId === g.id).map((p) => [p.id, flightLabel(g.name, i)] as const),
          ),
        );
        const common = {
          rule:
            state.event.qualifyMode === "overall"
              ? `Top ${state.event.qualifyOverall} overall`
              : `Top ${state.event.qualifyPerGroup}/flight`,
          advancingCount: state.advancingCount,
          fieldSize: state.confirmed.length,
          toWinners: draw.main.length,
          mainLabel: draw.mainLabel,
          secondLabel: draw.secondLabel,
          /**
           * A PLATE IS FILLED BY THE FIRST ROUND, not at the draw — so its count
           * was 0 over a draw of sixteen whose eight losers go into it. The losers
           * are the first-round ties actually played: the field less the byes.
           */
          toSecond:
            mode === "plate"
              ? plateEntrants(draw.main.length)
              : draw.second.length,
          secondNote: mode === "plate" ? "who lose in the first round" : "",
          cutoff: qualifyingPlayed ? state.overallCutoff : null,
        };
        /**
         * QUALIFIED ON CARDS, SHOWN ON CARDS (2026-10-10). The rows below are
         * match-play standings, which a medal or a Stableford qualifier never
         * fills: a 120-player qualifier into a 64-man knockout listed the field
         * in handicap order on 0 points each, beside a draw correctly seeded off
         * the cards. On cards, the rows are the stroke standings in the order
         * that seeded the draw, with the score that decided it.
         */
        if (state.qualifiesOnCards) {
          const stableford = state.qualifyingCutoff?.kind === "stableford";
          const figure = (s: (typeof state.strokeStandings)[number]) => (stableford ? s.points : s.toParShown);
          const shown = (s: (typeof state.strokeStandings)[number]) =>
            !s.ranked ? "—" : stableford ? `${s.points} pts` : toParText(s.toParShown);
          return {
            ...common,
            cutoffText: qualifyingPlayed ? qualifyingCutoffText(state.qualifyingCutoff, pts) : "—",
            qualifiers: state.strokeStandings
              .filter((s) => state.advancingIds.has(s.player.id))
              .map((s) => ({
                id: s.player.id,
                name: s.player.name,
                points: figure(s),
                shown: shown(s),
                advancing: true,
                flight: flightOf.get(s.player.id) ?? null,
              })),
            flights: state.groups.map((g, gi) => ({
              id: g.id,
              label: flightLabel(g.name, gi),
              rows: state.strokeStandings
                .filter((s) => s.player.groupId === g.id)
                .map((s) => ({
                  id: s.player.id,
                  rank: s.rank,
                  name: s.player.name,
                  points: figure(s),
                  shown: shown(s),
                  advancing: state.advancingIds.has(s.player.id),
                })),
            })),
          };
        }
        return {
          ...common,
          qualifiers: state.overall
            .filter((r) => state.advancingIds.has(r.player.id))
            .map((r) => ({
              id: r.player.id,
              name: r.player.name,
              points: r.stats.totalPoints,
              advancing: true,
              flight: flightOf.get(r.player.id) ?? null,
            })),
          flights: state.groupStandings.map((gs, gi) => ({
            id: gs.group.id,
            label: flightLabel(gs.group.name, gi),
            rows: gs.ranked.map((r) => ({
              id: r.player.id,
              rank: r.rank,
              name: r.player.name,
              points: r.stats.totalPoints,
              advancing: state.advancingIds.has(r.player.id),
            })),
          })),
        };
      })()
    : null;

  /**
   * SEVERAL FLIGHTS: what the panel that divides the field is handed.
   *
   * Which criteria this tournament can use is decided here, where the field is
   * known, and each one that cannot be used says why in the place it would be
   * chosen: "by qualifying score" with no qualifying round, "by your flights"
   * with none made or with somebody in none.
   */
  const playerRow = new Map(state.players.map((p) => [p.id, p]));
  const flightless = state.qualifiers.filter((q) => !playerRow.get(q.id)?.groupId).length;
  const flightChoices = FLIGHT_CRITERIA.map((c) => ({
    ...c,
    unavailable:
      c.key === "qualifying" && straight
        ? "This knockout has no qualifying round before it."
        : c.key === "flights" && state.groups.length === 0
          ? "This tournament has no flights yet. Make them on the Flights screen first."
          : c.key === "flights" && flightless > 0
            ? `${flightless} of the field ${flightless === 1 ? "is" : "are"} in no flight yet.`
            : "",
  }));
  const flightSummaries = state.flights
    ? state.flights.plan.brackets.map((b) => ({
        name: b.name,
        size: b.size,
        byes: b.byes,
        rounds: b.rounds,
        players: b.playerIds.map((id) => {
          const row = playerRow.get(id);
          return { id, name: row?.name ?? "A player who has left", index: row ? indexLabel(row) : "" };
        }),
      }))
    : null;

  return (
    <>
      <BracketModePicker mode={mode} secondLabel={secondLabel} readOnly={!isAdmin} locked={isSetupLocked(state.event)} />
      <BracketReports rows={reports} />
      {mode === "flights" && (
        <BracketFlights
          fieldSize={state.qualifiers.length}
          criteria={flightChoices}
          shapes={proposeShapes(state.qualifiers.length)}
          criterion={state.flights?.plan.criterion ?? null}
          flights={flightSummaries}
          unplaced={(state.flights?.unplaced ?? []).map((p) => ({ id: p.id, name: p.name }))}
          departed={(state.flights?.departedIds ?? []).map((id) => state.players.find((p) => p.id === id)?.name ?? "A player")}
          fixed={state.drawFrozen === true}
          readOnly={!isAdmin}
          finished={isFinished(state.event.status)}
        />
      )}
      <BracketClient
        winners={state.brackets.winners}
        consolation={state.brackets.consolation}
        draws={state.brackets.draws}
        /* The same string the mode picker is given, and the one `drawBrackets`
           uses to say whether there IS a second bracket and what it is called.
           Empty in `single` mode, "Consolation" in `split`, "Plate" in
           `plate`. */
        mainLabel={mainLabel}
        secondLabel={secondLabel}
        results={results}
        readOnly={!isStaff}
        straight={straight}
        notYetPlayed={!straight && !qualifyingPlayed}
        seeds={mode === "flights" ? undefined : seeds}
        playBy={playBy}
        toPlay={toPlayPanel}
        printTitle={state.event.name}
        locale={locale}
        seeded={drawsSeeded({ stages: state.stages, roundsWithResults: state.roundsWithResults, mode, criterion: state.flights?.plan.criterion ?? null, draws })}
        awaitingFlights={mode === "flights" && !state.flights}
      />
      {third && (
        <div className="card elev-sm" style={{ marginTop: 16, gap: 4 }}>
          <span className="card-kicker">Third place</span>
          <p style={{ fontSize: 14, margin: 0 }}>
            {third.pairing ? `${third.pairing.a.name} v ${third.pairing.b.name}` : "The two beaten semi-finalists"}
          </p>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            {third.made
              ? "The play-off is made. Its result goes in on Score entry."
              : third.pairing
                ? "Make the play-off on the knockout's card on Rounds & formats, then enter its result on Score entry."
                : "They play off for third once both semi-finals have a winner."}
          </p>
        </div>
      )}
      {straight && isStaff && mode !== "flights" && (
        <p className="text-muted" style={{ fontSize: 13, marginTop: 16, maxWidth: "62ch", lineHeight: 1.5 }}>
          No qualifying round comes before this bracket, so everyone in the field is in the draw
          ({state.qualifiers.length} {state.qualifiers.length === 1 ? "player" : "players"}), seeded in order.
          {" "}{byeLine(state.qualifiers.length)}
        </p>
      )}
      {/* In flights that sentence was wrong twice over: nobody is "in the draw" until the field is
          divided, and afterwards "36 players, seeded in order" describes no bracket on the screen. */}
      {straight && isStaff && mode === "flights" && state.flights && (
        <p className="text-muted" style={{ fontSize: 13, marginTop: 16, maxWidth: "62ch", lineHeight: 1.5 }}>
          No qualifying round comes before these flights, so everyone in the field belongs in one of them
          ({state.qualifiers.length} {state.qualifiers.length === 1 ? "player" : "players"}). Inside a flight
          the players are seeded in order, and where a flight does not fill a draw of 4, 8, 16, 32, 64 or 128 its
          top seeds get byes.
        </p>
      )}
      {/* Under the draw. Qualification comes first in time, so reading order
          argues for the top — but this is an `on-course` screen, tapped
          one-handed to advance a winner, and the audit is read sitting down.
          Leading with it would bury the thing the screen exists for behind the
          explanation of it. */}
      {qualification && <QualificationPanel {...qualification} />}
    </>
  );
}
