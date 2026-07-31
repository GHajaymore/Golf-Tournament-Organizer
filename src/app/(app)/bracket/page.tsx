import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { BracketClient } from "@/components/BracketClient";

export default async function BracketPage() {
  await requireScreen("bracket");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  return <BracketClient winners={state.brackets.winners} consolation={state.brackets.consolation} />;
}
