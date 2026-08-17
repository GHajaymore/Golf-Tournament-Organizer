import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { skinsPotFor, skinsSeasonFor } from "@/lib/services/skins-pot";
import { SkinsPotClient } from "@/components/SkinsPotClient";
import { SkinsSeason } from "@/components/SkinsSeason";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PrizesClient } from "@/components/PrizesClient";
import { ContestsClient } from "@/components/ContestsClient";

export default async function PrizesPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string }>;
}) {
  const session = await requireScreen("prizes");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const params = await searchParams;

  // The skins pot lives here rather than on its own screen because it is a
  // payout, and this is where a club already comes to settle up. Per round,
  // because a league runs one a week.
  const weeks = playingStages(state.stages);
  const week = weeks.find((s) => s.id === params.round) ?? state.activeStage ?? weeks[0] ?? null;
  // Gross and net are separate games with separate money, and a club commonly
  // runs both on the same night — the low handicaps play the gross, everybody
  // plays the net. Two pots, shown together.
  const [grossSkins, netSkins] = week
    ? await Promise.all([
        skinsPotFor(session.eventId, week.id, false),
        skinsPotFor(session.eventId, week.id, true),
      ])
    : [null, null];
  const skinsSeason = await skinsSeasonFor(session.eventId);

  const prizes = await prisma.prize.findMany({
    where: { eventId: session.eventId },
    orderBy: { position: "asc" },
  });

  // This round's side bets. Scoped to the round for the same reason the skins
  // pot is: a KP is a hole on a day, not a tournament-wide setting.
  const contests = week
    ? await prisma.contest.findMany({
        where: { eventId: session.eventId, stageId: week.id },
        orderBy: { createdAt: "asc" },
        include: { entrants: true },
      })
    : [];

  // The pots the cards settle. No winner is stored for these by design.
  const sideGames = week
    ? await prisma.sideGame.findMany({
        where: { eventId: session.eventId, stageId: week.id },
        include: { entrants: true },
      })
    : [];

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Results</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Prizes &amp; payouts</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Define the prize list and purse, then award winners. Flight winners, skins, closest-to-pin,
          long drive and any specials.
        </p>
      </div>
      <PrizesClient
        prizes={prizes.map((p) => ({
          id: p.id,
          category: p.category,
          detail: p.detail,
          amount: p.amount,
          winnerId: p.winnerId,
        }))}
        players={[...state.confirmed]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => ({ id: p.id, name: p.name }))}
      />
      {week && netSkins && (
        <SkinsPotClient
          rounds={weeks.map((s, i) => ({ stageId: s.id, label: `Round ${i + 1}` }))}
          activeStageId={week.id}
          view={netSkins}
        />
      )}
      {week && grossSkins && (
        <SkinsPotClient
          rounds={weeks.map((s, i) => ({ stageId: s.id, label: `Round ${i + 1}` }))}
          activeStageId={week.id}
          view={grossSkins}
        />
      )}
      {/* Side bets sit with the skins pot for the same stated reason: they are
          a payout, and this is where a club comes to settle up. Per round,
          because closest-to-the-pin is a hole on a day rather than a
          tournament-wide setting. */}
      {week && (
        <ContestsClient
          roundLabel={`Round ${weeks.findIndex((s) => s.id === week.id) + 1}`}
          stageId={week.id}
          contests={contests.map((c) => ({
            id: c.id,
            kind: c.kind,
            name: c.name,
            hole: c.hole,
            buyInCents: c.buyInCents,
            // Confirmed stakes are the pot; the rest are people who put their
            // own name down in the app and still owe the organizer cash.
            entrantIds: c.entrants.filter((e) => e.confirmed).map((e) => e.playerId),
            winnerIds: c.entrants.filter((e) => e.won).map((e) => e.playerId),
            potCents: c.buyInCents * c.entrants.filter((e) => e.confirmed).length,
            pending: c.entrants
              .filter((e) => !e.confirmed)
              .map((e) => ({
                playerId: e.playerId,
                name: state.confirmed.find((p) => p.id === e.playerId)?.name ?? "Unknown",
              })),
          }))}
          sideGames={sideGames.map((g) => ({
            id: g.id,
            kind: g.kind,
            buyInCents: g.buyInCents,
            /**
             * Confirmed stakes only — the same rule the contests above follow,
             * and this was the one place not following it.
             *
             * A player putting their own name down from the app writes an
             * unconfirmed row: an intention, not a stake. Counting it here put
             * money in the pot that nobody had handed over, so the payout was
             * split more ways than there was cash — the exact thing the
             * `confirmed` column was added to prevent, working everywhere
             * except the pots a player can actually join from their phone.
             */
            entrantIds: g.entrants.filter((e) => e.confirmed).map((e) => e.playerId),
            // And who still owes, so there is somewhere to collect it from.
            pending: g.entrants
              .filter((e) => !e.confirmed)
              .map((e) => ({
                playerId: e.playerId,
                name: state.confirmed.find((p) => p.id === e.playerId)?.name ?? "Unknown",
              })),
          }))}
          field={state.confirmed.map((p) => ({ id: p.id, name: p.name, playing: true }))}
        />
      )}
      <SkinsSeason rows={skinsSeason} />
    </>
  );
}
