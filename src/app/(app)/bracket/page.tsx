import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { canSeeLeaderboard } from "@/lib/tournament-settings";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { BracketClient } from "@/components/BracketClient";
import { BracketModePicker } from "@/components/BracketModePicker";
import { QualificationPanel } from "@/components/QualificationPanel";
import { isBracketMode, drawBrackets, type BracketMode } from "@/lib/domain";
import { isKnockoutRound } from "@/lib/stage-types";
import { BracketReports, type BracketReportRow } from "@/components/BracketReports";
import { bracketDraws, openTieReport } from "@/lib/domain/my-tie";
import { flightLabel } from "@/lib/domain/flight-label";

export const metadata = screenMetadata("/bracket");

export default async function BracketPage() {
  const session = await requireScreen("bracket");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  // Seeding is a direct read on the standings, so a blind event hides the
  // bracket from players for the same reason it hides the leaderboard.
  if (!canSeeLeaderboard(settingsOf(state.event), session.viewRole)) redirect("/dashboard");

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
  const straight = state.stages.findIndex((s) => isKnockoutRound(s.type)) === 0;

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
        return {
          rule:
            state.event.qualifyMode === "overall"
              ? `Top ${state.event.qualifyOverall} overall`
              : `Top ${state.event.qualifyPerGroup}/flight`,
          advancingCount: state.advancingCount,
          fieldSize: state.confirmed.length,
          toWinners: draw.main.length,
          secondLabel: draw.secondLabel,
          toSecond: draw.second.length,
          cutoff: state.overallCutoff,
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

  return (
    <>
      <BracketModePicker mode={mode} secondLabel={secondLabel} readOnly={!isAdmin} locked={isSetupLocked(state.event)} />
      <BracketReports rows={reports} />
      <BracketClient
        winners={state.brackets.winners}
        consolation={state.brackets.consolation}
        /* The same string the mode picker is given, and the one `drawBrackets`
           uses to say whether there IS a second bracket and what it is called.
           Empty in `single` mode, "Consolation" in `split`, "Plate" in
           `plate`. */
        mainLabel={mainLabel}
        secondLabel={secondLabel}
        results={results}
        readOnly={!isStaff}
        straight={straight}
      />
      {straight && isStaff && (
        <p className="text-muted" style={{ fontSize: 13, marginTop: 16, maxWidth: "62ch", lineHeight: 1.5 }}>
          No qualifying round comes before this bracket, so everyone in the field is in the draw
          ({state.qualifiers.length} {state.qualifiers.length === 1 ? "player" : "players"}), seeded in order.
          Where the numbers are not 4, 8, 16 or 32, the top seeds get byes.
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
