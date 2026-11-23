import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { isMatch } from "@/lib/tournament-shape";
import { groupGamesHome } from "@/lib/domain/money-parts";
import { GroupGames } from "@/components/money/GroupGames";
import { keepingPreview, screensShownFor } from "@/lib/services/screens-shown";

/**
 * Each fourball's own money, kept apart from the field's: the body is `GroupGames` (`components/money/GroupGames.tsx`), which
 * Winners & money also draws as its section. TourneyHQ works this out and writes it down. It never moves the money.
 */
export const metadata = screenMetadata("/group-games");

export default async function GroupGamesPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string }>;
}) {
  const session = await requireScreen("group-games");
  const params = await searchParams;
  /**
   * WITH WINNERS & MONEY SHOWN, A TOURNAMENT'S STAFF KEEP THE GROUPS' GAMES THERE (R8b; `MOVES`: `/group-games` for an admin or an
   * assistant, never a casual round, whose one screen stays). A player's own door to their group's games is not moved.
   * The one boolean is `shown.has("money")`; below it is the body, drawn only where nothing sent the person away.
   */
  const shown = await screensShownFor(session);
  const staff = session.role === "admin" || session.role === "assistant";
  // Asked only where it can matter, so the page with the switch off reads nothing more than it ever did.
  if (shown.has("money") && staff) {
    const event = await prisma.event.findUnique({ where: { id: session.eventId }, select: { shape: true } });
    if (groupGamesHome({ staff, casual: isMatch(event?.shape), moneyShown: true }) === "money") {
      const to = await keepingPreview(params.round ? `/money?round=${encodeURIComponent(params.round)}` : "/money");
      redirect(`${to}#groups`);
    }
  }
  return <GroupGames session={session} round={params.round} asSection={false} />;
}
