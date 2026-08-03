import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PrizesClient } from "@/components/PrizesClient";

export default async function PrizesPage() {
  const session = await requireScreen("prizes");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

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
    </>
  );
}
