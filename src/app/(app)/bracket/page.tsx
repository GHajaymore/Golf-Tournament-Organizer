import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { BracketClient } from "@/components/BracketClient";

export default async function BracketPage() {
  const session = await requireScreen("bracket");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const bw = await prisma.bracketWinner.findMany({ where: { eventId: session.eventId } });
  const results: Record<string, string> = {};
  for (const w of bw) if (w.result) results[w.key] = w.result;
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";

  return (
    <BracketClient
      winners={state.brackets.winners}
      consolation={state.brackets.consolation}
      results={results}
      readOnly={!isStaff}
    />
  );
}
