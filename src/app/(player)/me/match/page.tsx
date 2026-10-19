import Link from "next/link";
import { redirect } from "next/navigation";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { canEnterScores } from "@/lib/tournament-settings";
import { meFor } from "@/lib/services/me";
import { prisma } from "@/lib/db";
import { matchCardFor } from "@/lib/services/match-card";
import { lineupHidden } from "@/lib/domain/cup-lineup";
import { roundCodeName } from "@/lib/domain/round-label";
import { matchIsOver } from "@/lib/domain/match";
import type { HoleResult } from "@/lib/domain";
import { MatchKeeper } from "@/components/MatchKeeper";
import { DistanceUnitProvider } from "@/components/DistanceUnitProvider";
import { WayForward } from "@/components/WayForward";
import { keepMyMatchHoles, keepMyMatchResult } from "@/app/actions/tournament";

export const metadata = screenMetadata("/me/match");

/**
 * MY MATCH — a signed-in player keeps their own match, who won each hole, one
 * at a time (2026-10-18).
 *
 * At the first real cup every player scored by the round code, and the card
 * they used — one hole, who won it, saved as they go — was praised. Ajay: "keep
 * it in player app along with leaderboard money and other things. it was very
 * simple today and I want to keep it that way". The player app had no such
 * card: a cup's "Score this match" opened the console's stroke cards, which,
 * saved, rebuild the match from strokes and overwrite the holes somebody had
 * tapped. So this is that card — `MatchKeeper`, the very one `/play` draws,
 * built by the same `matchCardFor` — for the player's own matches, singles and
 * four-balls alike.
 *
 * Only the player's own matches are looked up, so `?m=` naming somebody else's
 * finds nothing; and the save asks again regardless (`assertOwnMatch`).
 */
export default async function MyMatchPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const session = await requireSession();
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const me = await meFor(state, session.email);
  const settings = settingsOf(state.event);

  const sides = me.playerId
    ? (await prisma.teamMember.findMany({ where: { playerId: me.playerId, team: { eventId: state.event.id } }, select: { teamId: true } })).map((t) => t.teamId)
    : [];
  const [mine, stages] = await Promise.all([
    me.playerId
      ? prisma.match.findMany({
          where: {
            eventId: state.event.id,
            OR: [
              { playerAId: me.playerId },
              { playerBId: me.playerId },
              ...(sides.length ? [{ teamAId: { in: sides } }, { teamBId: { in: sides } }] : []),
            ],
          },
          orderBy: [{ round: "asc" }, { id: "asc" }],
        })
      : [],
    prisma.stage.findMany({
      where: { eventId: state.event.id },
      orderBy: { position: "asc" },
      select: { id: true, type: true, position: true, format: true, holes: true, nine: true, lineupPublished: true },
    }),
  ]);
  const stageById = new Map(stages.map((s) => [s.id, s]));
  // A cup lineup the organizer has not announced is nobody's match yet.
  const open = mine
    .filter((x) => {
      const s = stageById.get(x.stageId);
      return s && !lineupHidden(s);
    })
    .sort((a, b) => (stageById.get(a.stageId)?.position ?? 0) - (stageById.get(b.stageId)?.position ?? 0) || a.round - b.round);

  const holesOf = (json: string): HoleResult[] => {
    try {
      return JSON.parse(json) as HoleResult[];
    } catch {
      return [];
    }
  };
  const { m: picked } = await searchParams;
  // The one asked for; otherwise the first still being played; otherwise the last.
  const match =
    open.find((x) => x.id === picked) ?? open.find((x) => !matchIsOver(holesOf(x.holes))) ?? open[open.length - 1] ?? null;

  if (!match || !me.playerId) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My match</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          You have no match to keep in this tournament. A match appears here once the draw puts you in one.
        </p>
        <WayForward
          links={[
            { href: "/me", label: "Back to Today", icon: "flag" },
            { href: "/me/board", label: "See the board", icon: "ranking" },
          ]}
        />
      </div>
    );
  }

  if (!canEnterScores(settings, session.role)) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My match</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          The organizer enters the scores in this tournament. Your match appears on the board as they go in.
        </p>
        <WayForward links={[{ href: "/me/board", label: "See the board", icon: "ranking" }]} />
      </div>
    );
  }

  const holderSides = sides;
  const card = await matchCardFor({ match, holderId: me.playerId, holderSides });
  const stage = stageById.get(match.stageId);

  // The other matches, named by opponent — a round robin, or the cup's two sessions.
  const others = open.filter((x) => x.id !== match.id);
  const otherIds = others.map((x) =>
    x.playerAId === "" && x.playerBId === ""
      ? holderSides.includes(x.teamAId) ? x.teamBId : x.teamAId
      : x.playerAId === me.playerId ? x.playerBId : x.playerAId,
  );
  const otherNames = otherIds.length
    ? new Map([
        ...(await prisma.player.findMany({ where: { id: { in: otherIds }, eventId: state.event.id }, select: { id: true, name: true } })).map((p) => [p.id, p.name] as const),
        ...(await prisma.team.findMany({ where: { id: { in: otherIds }, eventId: state.event.id }, select: { id: true, name: true } })).map((t) => [t.id, t.name] as const),
      ])
    : new Map<string, string>();

  return (
    <DistanceUnitProvider unit={card.unit}>
      <MatchKeeper
        match={card.match}
        holes={card.holes}
        pars={card.pars}
        yards={card.yards}
        strokeIndex={card.strokeIndex}
        cardStrokeIndex={card.cardStrokeIndex}
        firstHole={card.firstHole}
        matchShots={card.matchShots}
        voiceEntry={settings.voiceEntry}
        submitWhole={settings.scoreEntryWindow === "after"}
        stageId={match.stageId}
        roundLabel={stage ? roundCodeName(stages, stage) : ""}
        eventName={state.event.name}
        otherMatches={others.map((x, i) => ({ href: `/me/match?m=${encodeURIComponent(x.id)}`, label: `v ${otherNames.get(otherIds[i]) ?? "opponent"}` }))}
        saveHoles={keepMyMatchHoles}
        saveResult={keepMyMatchResult}
        next={
          <Link className="btn btn-secondary" href="/me" style={{ minHeight: 44 }}>
            Back to Today
          </Link>
        }
      />
    </DistanceUnitProvider>
  );
}
