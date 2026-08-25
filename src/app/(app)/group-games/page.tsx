import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { skinsPotFor } from "@/lib/services/skins-pot";
import { SkinsPotClient } from "@/components/SkinsPotClient";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";
import { redirect } from "next/navigation";

/**
 * Each fourball's own money, kept apart from the field's.
 *
 * A separate screen rather than more cards on Prizes & payouts, because these
 * are different money with different owners. The field's pot is the club's and
 * the organizer runs it; a group's pot is four players' own $20, and the
 * people it belongs to can run it themselves. Mixing them into one column of
 * identical cards is how somebody pays into the wrong one.
 *
 * The groups come from the round's published TEE SHEET, which is the only
 * place the app knows who is playing with whom. No sheet, no groups — and the
 * screen says so rather than rendering an empty page that looks broken.
 *
 * TourneyHQ works this out and writes it down. It never moves the money.
 */
export default async function GroupGamesPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string }>;
}) {
  const session = await requireScreen("group-games");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const params = await searchParams;

  const weeks = playingStages(state.stages);
  const week = weeks.find((s) => s.id === params.round) ?? state.activeStage ?? weeks[0] ?? null;
  const rounds = weeks.map((s, i) => ({ stageId: s.id, label: `Round ${i + 1}` }));

  const sheet = week ? parseTeeSheet(week.teeSheet ?? "") : null;
  // A group of one cannot run a skins game against itself. Filtering here
  // rather than in the loop keeps the empty-state message honest: "no groups"
  // then means no group that could hold a game.
  const groups = (sheet?.groups ?? []).filter((g) => g.playerIds.length > 1);

  /**
   * One net pot per group, loaded in parallel.
   *
   * Net rather than gross, and full-round rather than a nine, because that is
   * the game a fourball actually agrees on the first tee. Anything else is
   * available from the card's own controls once it exists — this is the
   * starting point, not the whole menu.
   */
  const pots = week
    ? await Promise.all(
        groups.map(async (g) => ({
          group: g,
          view: await skinsPotFor(session.eventId, week.id, true, "full", g.name),
        })),
      )
    : [];

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Group games</h1>
        <p className="page-sub">
          A fourball&rsquo;s own skins, separate from the club&rsquo;s pot. Anyone playing in a
          group can set up that group&rsquo;s game — it never touches the field&rsquo;s money, and
          the settle-up folds both into one number per player.
        </p>
      </div>

      {rounds.length > 1 && week && (
        <div className="card elev-sm" style={{ marginTop: 12 }}>
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Round</label>
            <select className="input" defaultValue={week.id} name="round" disabled>
              {rounds.map((r) => (
                <option key={r.stageId} value={r.stageId}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!week && (
        <div className="card elev-sm" style={{ marginTop: 16 }}>
          <p className="text-muted" style={{ margin: 0, fontSize: 13.5 }}>
            No rounds yet. Add a round and publish its tee sheet, and each group can run its own
            game here.
          </p>
        </div>
      )}

      {week && groups.length === 0 && (
        <div className="card elev-sm" style={{ marginTop: 16 }}>
          <p className="text-muted" style={{ margin: 0, fontSize: 13.5 }}>
            This round has no tee sheet yet, so the app doesn&rsquo;t know who is playing with
            whom. Publish the tee sheet and every group appears here with its own pot.
          </p>
        </div>
      )}

      {pots.map(({ group, view }) =>
        view ? (
          <SkinsPotClient
            key={group.name}
            rounds={rounds}
            activeStageId={week!.id}
            view={view}
            groupKey={group.name}
            groupLabel={group.name}
          />
        ) : null,
      )}
    </>
  );
}
