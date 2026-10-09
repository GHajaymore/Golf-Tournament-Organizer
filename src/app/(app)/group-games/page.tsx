import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { roundLabel } from "@/lib/domain/round-label";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { skinsPotFor } from "@/lib/services/skins-pot";
import { SkinsPotClient } from "@/components/SkinsPotClient";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SideBetStart } from "@/components/SideBetStart";
import { RoundPicker } from "@/components/RoundPicker";
import { isMatch } from "@/lib/tournament-shape";
import { casualMoney, moneyWaitsFor } from "@/lib/services/casual-round";
import { playedOnceRoundIsOver } from "@/lib/services/expenses";
import { Icon } from "@/components/Icon";
import { perPlayerPotRefusal } from "@/lib/domain/shared-ball";
import { ContestsClient } from "@/components/ContestsClient";
import { isHeadToHead } from "@/lib/stage-types";
import { potMembership, isPotEntryMode } from "@/lib/domain/pot-entry";
import { golfTermsForEvent } from "@/lib/services/organization";
import { potsOfGroup, type SkinsScope } from "@/lib/domain/skins-pot";

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
export const metadata = screenMetadata("/group-games");

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
  // `boardStage`, the same default as `/prizes` and the player's `/me/money`.
  // A side game belongs to the round it was played in. Only the default; the
  // round picker still wins.
  const week = weeks.find((s) => s.id === params.round) ?? state.boardStage ?? weeks[0] ?? null;
  const rounds = weeks.map((s) => ({ stageId: s.id, label: roundLabel(weeks, s.id) }));

  /**
   * A casual round IS one group, so it does not wait for a tee sheet.
   *
   * The groups on this screen come from the round's published tee sheet,
   * because that is the only record of who is playing with whom in a field of
   * sixty. A quick round has no tee sheet and never will — it is two to eight
   * people who are all playing together, which is the same fact the sheet
   * exists to record, already known.
   *
   * So the pot is the FIELD's, keyed on `""`. Not a workaround: `potAudience`
   * returns the whole field for the empty key, and on a casual round the whole
   * field is the group — the two definitions coincide rather than one being
   * bent to fit the other.
   */
  const casual = isMatch(state.event.shape);
  const terms = await golfTermsForEvent(session.eventId);

  /**
   * WHY NO POT CAN RUN ON THIS ROUND, OR "" — asked ONCE, because three things
   * on this screen depend on the answer and two of them were not asking.
   *
   * The refusal panel below said "Foursomes is played with one ball per side,
   * so there are no individual scores to decide a pot on", and then the screen
   * carried on offering exactly that: a sentence promising "publish a tee
   * sheet and every group gets its own pot here", and a Start a side bet
   * control whose action refuses the same round with the same words. Read off
   * the seeded club on 2026-09-20, all three in one screenful.
   *
   * The comment on that panel already stated the principle — "a control that
   * takes an answer and then rejects it is worse than one that explains
   * itself" — and the panel was the only part that kept it.
   */
  const noPerPlayerPot = week ? perPlayerPotRefusal(week.format) : null;

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
  /**
   * EVERY POT A GROUP HAS, NOT THE ONE THIS SCREEN EXPECTS (2026-10-09, grid
   * cell T69). A pot is keyed on (round, net, scope, group), and this asked
   * each group for its net full-round pot only. Choosing "Front 9" on the card
   * and saving created a SECOND pot under (net, front) — which the settle-up
   * reads and this screen never showed again, so the choice appeared not to
   * stick and the money sat where nobody could see it. Prizes was taught the
   * same thing for the field's pots; this is the group half.
   *
   * A group with no pot yet still offers the default one to start.
   */
  const groupPotRows = week
    ? await prisma.skinsPot.findMany({
        where: { stageId: week.id, groupKey: { not: "" } },
        select: { groupKey: true, net: true, scope: true },
        orderBy: [{ groupKey: "asc" }, { scope: "asc" }, { net: "asc" }],
      })
    : [];
  const potKey = (name: string, g: { net: boolean; scope: SkinsScope }) =>
    `${name}-${g.net ? "net" : "gross"}-${g.scope}`;

  const pots = week
    ? await Promise.all(
        groups.flatMap((g) =>
          potsOfGroup(groupPotRows, g.name, true).map(async (game) => ({
            group: g,
            key: potKey(g.name, game),
            view: await skinsPotFor(session.eventId, week.id, game.net, game.scope, g.name),
          })),
        ),
      )
    : [];

  /**
   * Bets that are neither the club's nor one fourball's.
   *
   * Six friends across three groups who agreed something on the first tee.
   * They are stored as pots under a name the players chose, so they are found
   * by looking for group keys this round's tee sheet does not account for —
   * including any left orphaned by a redraw, which must keep working rather
   * than disappear with the money in them.
   */
  const groupNames = new Set(groups.map((g) => g.name));
  // One name per bet, however many pots it runs.
  const adHocNames = [...new Set(groupPotRows.map((r) => r.groupKey))].filter((k) => !groupNames.has(k));
  const adHoc = week
    ? await Promise.all(
        adHocNames.flatMap((name) =>
          potsOfGroup(groupPotRows, name, false).map(async (game) => ({
            name,
            key: potKey(name, game),
            view: await skinsPotFor(session.eventId, week.id, game.net, game.scope, name),
          })),
        ),
      )
    : [];

  /**
   * The names already spoken for on this round, and by WHICH game.
   *
   * A game is keyed on (round, kind, name), so the same crew running skins and
   * a birdie pot under one name is two rows that settle together rather than a
   * collision. Only a tee-sheet group name is reserved outright — an ad-hoc bet
   * borrowing it would silently narrow its own audience to that fourball.
   */
  const sideGameKeys = week
    ? (
        await prisma.sideGame.findMany({
          where: { stageId: week.id, groupKey: { not: "" } },
          select: { groupKey: true, kind: true },
        })
      ).map((r) => ({ name: r.groupKey, kind: r.kind }))
    : [];

  /**
   * The round's own pot, for a casual round only.
   *
   * MATCHED TO THE ROUND, not to a pair of defaults. A `SkinsPot` is keyed on
   * (round, net, scope, group), so asking for the net full-round pot returns a
   * DIFFERENT ROW from a gross one or a front-nine one — an empty one, which
   * renders as "no pot yet" beside a round that has a real pot on it with real
   * money in it.
   *
   * That is exactly what happened: a level round set up with a £5 skins pot
   * created a GROSS pot, this screen asked for the NET one, and the money
   * screen showed an empty net pot while the game the players had agreed was
   * invisible. Found by reading the row back after setting one up rather than
   * by looking at the screen, which looked plausible.
   *
   * So both facts come from the round. A level round's skins are gross —
   * allocating shots the players agreed not to give would be inventing a
   * different game — and a nine-hole round's pot is over that nine.
   */
  const roundPot =
    casual && week
      ? await skinsPotFor(
          session.eventId,
          week.id,
          week.scoringBasis === "net",
          week.nine === "front" || week.nine === "back" ? week.nine : "full",
          "",
        )
      : null;

  /**
   * The round's own SIDE games — a birdie pot, a Nassau — for a casual round.
   *
   * These are the field's games (`groupKey: ""`), and the field's games have
   * only ever rendered on Prizes & payouts. A casual round no longer has that
   * screen, so a birdie pot set up with the round existed, held real money,
   * and appeared NOWHERE: the money screen showed an empty skins card beside
   * it and never mentioned it.
   *
   * Found the same way as the skins mismatch just above — by reading the row
   * back after setting one up, rather than by looking at a screen that seemed
   * fine. Both are the same shape of defect: money created against one key and
   * displayed from another.
   */
  const roundSideGames =
    casual && week
      ? await prisma.sideGame.findMany({
          where: { eventId: session.eventId, stageId: week.id, groupKey: "" },
          include: { entrants: true },
        })
      : [];

  // Confirmed entries only: an opt-out pot means "everyone PLAYING", and a
  // waitlisted player is not playing. The same rule Prizes uses, asked the
  // same way, so the two screens cannot disagree about who is in a pot.
  const potFieldIds = state.confirmed.map((p) => p.id);
  const potStakeholderIds = state.players.map((p) => p.id);
  const potNameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? "Unknown";
  const potModeOf = (v: string) => (isPotEntryMode(v) ? v : "opt-in");

  // The round's money, as its own screen reads it — see the card below.
  const cash = casual ? await casualMoney(session.eventId, session.email) : null;

  // Everyone with a row who is no longer playing — named on a pot they left a
  // stake in (see `keepDefaultStakes`).
  const confirmedIds = new Set(state.confirmed.map((p) => p.id));
  const departedPlayers = state.players.filter((p) => !confirmedIds.has(p.id)).map((p) => ({ id: p.id, name: p.name }));

  // Once the round is over, only those who played it — as the settle-up charges.
  const playedOnceOver = await playedOnceRoundIsOver(session.eventId, roundSideGames);
  const sideGameViews = roundSideGames.map((g) => {
    const m = potMembership(potModeOf(g.entryMode), potFieldIds, g.entrants, potStakeholderIds, playedOnceOver(g.stageId));
    return {
      id: g.id,
      kind: g.kind,
      buyInCents: g.buyInCents,
      stakeNote: g.stakeNote,
      entryMode: potModeOf(g.entryMode),
      entrantIds: m.entrants,
      pending: m.pending.map((playerId) => ({ playerId, name: potNameOf(playerId) })),
      excluded: m.excluded.map((playerId) => ({ playerId, name: potNameOf(playerId) })),
    };
  });

  /**
   * ONLY THE GAMES BEING PLAYED, THEN "ADD A GAME" (2026-10-07).
   *
   * A two-man Nassau's money screen carried an empty skins card and six stake
   * boxes, five of them blank — and the owner read the list as "a bunch of
   * rounds". On a casual round the games ON (a stake, a "for a pint", or
   * anybody in) are shown; everything else is one fold below them.
   */
  const potOn = !!roundPot && (roundPot.buyInCents > 0 || !!roundPot.stakeNote?.trim() || roundPot.entrantIds.length > 0);
  const sideOn = roundSideGames.some((g) => g.buyInCents > 0 || g.stakeNote.trim() !== "");

  const fieldForBets = [...state.confirmed]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{casual ? "Money game" : "Group games"}</h1>
        {/* Two screens' worth of wording, because they are two situations.
            A tournament's version is about which of several groups a pot
            belongs to; a casual round has one group and the only question is
            what the stake is. Telling four friends that this "does not touch
            the field's money" answers a question they have never had. */}
        <p className="page-sub">
          {casual ? (
            <>
              Playing for something? Everyone in this round is in, the app works out who won
              what, and it never touches the money — it says who owes whom and you settle it
              yourselves.
            </>
          ) : (
            <>
              Games that are not the club&rsquo;s: a {terms.group}&rsquo;s own skins, or a bet between
              whoever wants in wherever they are playing. Anyone in a group can set up that
              group&rsquo;s game and anyone can start a side bet — neither touches the
              field&rsquo;s money, and the settle-up folds all of it into one number per player.
            </>
          )}
        </p>
      </div>

      {/* THE ANSWER, ABOVE THE GAMES THAT PRODUCED IT (2026-10-07).
          The round's screen links here as "The money in full", and for every
          game but skins this page held the stakes and never the result: a
          finished Nassau read as three stake boxes while the round's screen
          said who pays whom. Each player's position and the handovers, from
          the reader the round's screen uses, so the two cannot disagree. */}
      {cash?.anyGame && (
        <section className="card elev-sm" style={{ marginTop: 16, gap: 8 }} aria-label="Where the money ends up">
          <span className="card-title" style={{ fontSize: 15 }}>Where the money ends up</span>
          {cash.final ? (
            <>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                {cash.positions.map((p) => (
                  <li key={p.name} data-position style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 15 }}>
                    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p.name}</span>
                    <b style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{p.text}</b>
                  </li>
                ))}
              </ul>
              {cash.handovers.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
                  {cash.handovers.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: 0, fontSize: 15 }}>Everyone&rsquo;s square.</p>
              )}
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
              {cash.stake ? `${cash.stake} ` : ""}
              {moneyWaitsFor(state, cash.nassau)}
            </p>
          )}
        </section>
      )}

      {rounds.length > 1 && week && (
        <div className="card elev-sm" style={{ marginTop: 12 }}>
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Round</label>
            {/* Was `disabled`: it listed every round of the event, showed the
                current one, and could not be changed — on a page that reads
                `?round=` and renders whichever round it is given. */}
            <RoundPicker rounds={rounds} activeStageId={week.id} />
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

      {/* ONE BALL PER SIDE, SO NO PER-PLAYER POT (2026-09-20).
          Skins, birdies, low net: every game on this screen is decided by what
          a PLAYER did on a hole, and a foursomes has one card per side. The
          actions refuse it — see `perPlayerPotRefusal` — and this is the
          screen saying so BEFORE somebody types a stake, because a control
          that takes an answer and then rejects it is worse than one that
          explains itself. Measured on a seeded foursomes whose £5 pot could
          never settle. */}
      {noPerPlayerPot && (
        <div className="card elev-sm" style={{ marginTop: 16 }}>
          <span className="card-title" style={{ fontSize: 14 }}>
            No pots on this round
          </span>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.6 }}>
            {noPerPlayerPot}
          </p>
        </div>
      )}

      {/* NOT shown on a casual round, and this is the change that made the
          screen usable there at all. It told four friends to publish a tee
          sheet — apparatus a quick round does not have and is never offered —
          so the money screen's entire content was an instruction they could
          not follow. Their pot renders below instead. */}
      {/* And NOT on a round that can hold no pot whatever the tee sheet says.
          "Publish one and every group gets its own pot here" is an instruction
          with no outcome on a foursomes — the panel directly above has just
          explained that there are no individual scores to divide, and this
          promised the opposite two inches below it. */}
      {week && groups.length === 0 && !casual && !noPerPlayerPot && (
        <div className="card elev-sm" style={{ marginTop: 16 }}>
          <p className="text-muted" style={{ margin: 0, fontSize: 13.5 }}>
            No tee sheet on this round yet, so the app doesn&rsquo;t know who is playing with whom
            — publish one and every group gets its own pot here. A side bet doesn&rsquo;t wait for
            it: name it, pick who&rsquo;s in, and it settles the same way.
          </p>
        </div>
      )}

      {/* The whole round's pot. Everyone playing is in it. Once it is a game
          being played — otherwise it is under "Add a game" below. */}
      {roundPot && week && potOn && (
        <SkinsPotClient
          rounds={rounds}
          activeStageId={week.id}
          view={roundPot}
          groupKey=""
          groupLabel="Everyone in this round"
        />
      )}

      {pots.map(({ group, key, view }) =>
        view ? (
          <SkinsPotClient
            key={key}
            rounds={rounds}
            activeStageId={week!.id}
            view={view}
            groupKey={group.name}
            groupLabel={group.name}
          />
        ) : null,
      )}

      {/* The round's own side games, for a casual round. Contests are empty on
          purpose: a closest-to-the-pin is a thing a club puts on for a field,
          and this screen belongs to the people playing. */}
      {casual && week && sideOn && (
        <ContestsClient
          roundLabel="this round"
          stageId={week.id}
          contests={[]}
          sideGames={sideGameViews}
          field={state.confirmed.map((p) => ({ id: p.id, name: p.name, playing: true }))}
            departed={departedPlayers}
          /* The intent this screen has always had, now honoured by the
             component: a closest-to-the-pin is a thing a club puts on for a
             field, and this screen belongs to the people playing. Passing an
             empty list was not enough — the adder and the whole block
             rendered anyway. */
          contestsApply={false}
          headToHead={isHeadToHead(week.type)}
          rows="on"
        />
      )}

      {/* The bets that cross fourballs, after the fourballs' own. */}
      {adHoc.map(({ name, key, view }) =>
        view ? (
          <SkinsPotClient
            key={key}
            rounds={rounds}
            activeStageId={week!.id}
            view={view}
            groupKey={name}
            groupLabel={name}
          />
        ) : null,
      )}

      {/* THE DOOR, CLOSED ON THE ROUND THAT REFUSES EVERYTHING BEHIND IT.
          `saveSideGame` turns a shared-ball round down with the same sentence
          the panel above prints, so this opened a form, took a name, a stake
          and a list of players, and then said no. Offered again the moment the
          organizer picks a round that plays its own ball — the picker is right
          there, which is the thing to do about it. */}
      {/* EVERY GAME NOT BEING PLAYED, ONE FOLD (casual — see `potOn`). Open
          when nothing is on yet, because then adding one is the only thing
          this screen is for. */}
      {casual && week && !noPerPlayerPot && (
        <details open={!potOn && !sideOn} style={{ marginTop: 16 }}>
          <summary
            className="touch-target"
            style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 15, fontWeight: 600, color: "var(--color-accent-200)", listStyle: "none" }}
          >
            <Icon name="plus" aria-hidden /> Add a game
          </summary>
          {roundPot && !potOn && (
            <SkinsPotClient rounds={rounds} activeStageId={week.id} view={roundPot} groupKey="" groupLabel="Everyone in this round" />
          )}
          <ContestsClient
            roundLabel="this round"
            stageId={week.id}
            contests={[]}
            sideGames={sideGameViews}
            field={state.confirmed.map((p) => ({ id: p.id, name: p.name, playing: true }))}
            departed={departedPlayers}
            contestsApply={false}
            headToHead={isHeadToHead(week.type)}
            rows="off"
            title="More games, settled by the scores"
          />
          <SideBetStart
            stageId={week.id}
            field={fieldForBets}
            groups={sheet?.groups ?? []}
            taken={[
              ...[...groupNames].map((name) => ({ name, kind: "*" })),
              ...adHocNames.map((name) => ({ name, kind: "skins" })),
              ...sideGameKeys,
            ]}
          />
        </details>
      )}

      {!casual && week && !noPerPlayerPot && (
        <SideBetStart
          stageId={week.id}
          field={fieldForBets}
          groups={sheet?.groups ?? []}
          taken={[
            ...[...groupNames].map((name) => ({ name, kind: "*" })),
            ...adHocNames.map((name) => ({ name, kind: "skins" })),
            ...sideGameKeys,
          ]}
        />
      )}
    </>
  );
}
