import Link from "next/link";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { isMatch } from "@/lib/tournament-shape";
import { groupGamesMovedTo } from "@/lib/domain/group-games-door";
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
   * WITH WINNERS & MONEY SHOWN, A TOURNAMENT'S STAFF KEEP THE GROUPS' GAMES THERE. Whether they are moved is asked of `relocate`
   * (the `MOVES` row for this door), never written again here. The old address still OPENS (200, on its own path, as every old door
   * does while a redesigned screen is shown: `lifecycle-menu.spec`) and says where the games are, with a link; the body is then not
   * drawn, so `GroupGames` is mounted once. Asked only when a screen is shown, so the page with the switch off reads nothing more.
   */
  const shown = await screensShownFor(session);
  if (shown.size > 0) {
    const event = await prisma.event.findUnique({ where: { id: session.eventId }, select: { shape: true } });
    const to = groupGamesMovedTo(session.viewRole, isMatch(event?.shape), shown, params.round);
    if (to) {
      return (
        <>
          <div className="page-kicker">Results</div>
          <h1 className="page-title">Side games</h1>
          <section className="card">
            <p style={{ margin: 0 }}>
              The groups&rsquo; side games are now on <Link href={await keepingPreview(to)}>Winners &amp; money, under Groups&rsquo; side games</Link>.
            </p>
          </section>
        </>
      );
    }
  }
  return <GroupGames session={session} round={params.round} asSection={false} />;
}
