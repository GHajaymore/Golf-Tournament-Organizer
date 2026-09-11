import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { canSeeLeaderboard } from "@/lib/tournament-settings";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { BracketClient } from "@/components/BracketClient";
import { BracketModePicker } from "@/components/BracketModePicker";
import { QualificationPanel } from "@/components/QualificationPanel";
import { isBracketMode, drawBrackets, type BracketMode } from "@/lib/domain";

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

  const mode: BracketMode = isBracketMode(state.event.bracketMode) ? state.event.bracketMode : "split";
  const secondLabel = drawBrackets([], mode).secondLabel;

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
  const qualification = isStaff
    ? (() => {
        const draw = drawBrackets(state.qualifiers, mode);
        const flightOf = new Map(
          state.groups.flatMap((g, i) =>
            state.confirmed.filter((p) => p.groupId === g.id).map((p) => [p.id, i + 1] as const),
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
            number: gi + 1,
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
      <BracketModePicker mode={mode} secondLabel={secondLabel} readOnly={!isStaff} />
      <BracketClient
        winners={state.brackets.winners}
        consolation={state.brackets.consolation}
        results={results}
        readOnly={!isStaff}
      />
      {/* Under the draw. Qualification comes first in time, so reading order
          argues for the top — but this is an `on-course` screen, tapped
          one-handed to advance a winner, and the audit is read sitting down.
          Leading with it would bury the thing the screen exists for behind the
          explanation of it. */}
      {qualification && <QualificationPanel {...qualification} />}
    </>
  );
}
