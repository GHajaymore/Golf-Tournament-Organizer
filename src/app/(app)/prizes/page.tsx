import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { skinsPotFor, skinsSeasonFor } from "@/lib/services/skins-pot";
import { SkinsPotClient } from "@/components/SkinsPotClient";
import { SkinsSeason } from "@/components/SkinsSeason";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PrizesClient } from "@/components/PrizesClient";

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
      <SkinsSeason rows={skinsSeason} />
    </>
  );
}
