import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { skinsPotFor, skinsSeasonFor } from "@/lib/services/skins-pot";
import { isSkinsScope, type SkinsScope } from "@/lib/domain/skins-pot";
import { SkinsPotClient } from "@/components/SkinsPotClient";
import { SkinsSeason } from "@/components/SkinsSeason";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PrizesClient } from "@/components/PrizesClient";
import { ContestsClient } from "@/components/ContestsClient";
import { potMembership, isPotEntryMode } from "@/lib/domain/pot-entry";
import { resolveMoneyMode } from "@/lib/domain/money-mode";
import { MoneySetup } from "@/components/MoneySetup";
import { FloatClient } from "@/components/FloatClient";
import { OrganizerLedger } from "@/components/OrganizerLedger";
import { moneyFor } from "@/lib/services/expenses";

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
  /**
   * Every game this round runs, not a fixed gross-and-net pair.
   *
   * Gross and net are separate games with separate money, and a league adds a
   * second axis: front nine and back nine. Four games on one night is
   * ordinary. This asked for exactly two whole-round pots, so the other two
   * could be created from the scope dropdown and then never shown again.
   *
   * A round with no pot yet still offers ONE to set up — otherwise there is
   * no way to start the first one from an empty screen.
   */
  const potRows = week
    ? await prisma.skinsPot.findMany({
        // The club's pots. A fourball's own game belongs on Group games —
        // without this the field's pot rendered once per group pot on the
        // round, with a duplicate React key, and no group pot appeared.
        where: { stageId: week.id, groupKey: "" },
        select: { net: true, scope: true },
        orderBy: [{ scope: "asc" }, { net: "asc" }],
      })
    : [];
  const wanted = potRows.length
    ? potRows.map((p) => ({ net: p.net, scope: (isSkinsScope(p.scope) ? p.scope : "full") as SkinsScope }))
    : [{ net: true, scope: "full" as SkinsScope }];
  const skinsGames = week
    ? (
        await Promise.all(
          wanted.map(async (w) => ({
            key: `${w.net ? "net" : "gross"}-${w.scope}`,
            view: await skinsPotFor(session.eventId, week.id, w.net, w.scope, ""),
          })),
        )
      ).filter((g): g is { key: string; view: NonNullable<typeof g.view> } => g.view !== null)
    : [];
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

  /**
   * The field a pot draws its members from, and a name for an id.
   *
   * Confirmed entries only: an opt-out pot means "everyone PLAYING", and a
   * waitlisted player is not playing. Shared by both pot types so they cannot
   * disagree about who the field is.
   */
  const fieldIds = state.confirmed.map((p) => p.id);
  const nameOf = (id: string) => state.confirmed.find((p) => p.id === id)?.name ?? "Unknown";
  // A stored mode is free text; anything unrecognised falls back to the
  // original behaviour rather than to whichever branch happens to be the else.
  const modeOf = (v: string) => (isPotEntryMode(v) ? v : "opt-in");

  // How this tournament handles money at all, and the kitty when it keeps one.
  const org = await prisma.organization.findUnique({
    where: { id: state.event.organizationId },
    select: { name: true, shortName: true, kind: true, moneyMode: true, currencySymbol: true },
  });
  const moneyMode = resolveMoneyMode({
    eventMode: state.event.moneyMode,
    orgMode: org?.moneyMode,
    orgKind: org?.kind,
  });
  const isStaff = session.role === "admin" || session.role === "assistant";
  /**
   * The ledger for whoever is running it.
   *
   * Read with the organizer's own email, which is right even when they are not
   * playing: everything a treasurer needs — the standing, the transfers, the
   * lines — is event-wide, and the "you" parts simply have nobody to match.
   */
  const ledger = moneyMode === "split" && isStaff ? await moneyFor(session.eventId, session.email, { name: session.name, isStaff }) : null;
  const fundLines =
    moneyMode === "float"
      ? await prisma.tournamentFund.findMany({
          where: { eventId: session.eventId },
          orderBy: { createdAt: "desc" },
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
      {week &&
        skinsGames.map((g) => (
          <SkinsPotClient
            key={g.key}
            rounds={weeks.map((s, i) => ({ stageId: s.id, label: `Round ${i + 1}` }))}
            activeStageId={week.id}
            view={g.view}
          />
        ))}
      {/* Side bets sit with the skins pot for the same stated reason: they are
          a payout, and this is where a club comes to settle up. Per round,
          because closest-to-the-pin is a hole on a day rather than a
          tournament-wide setting. */}
      {week && (
        <ContestsClient
          roundLabel={`Round ${weeks.findIndex((s) => s.id === week.id) + 1}`}
          stageId={week.id}
          contests={contests.map((c) => {
            // One rule for both modes — see potMembership. Opt-in counts the
            // rows that exist; opt-out counts the field minus whoever said
            // otherwise, so a weekly contest needs no ticking and a player
            // entered later joins by himself.
            const m = potMembership(modeOf(c.entryMode), fieldIds, c.entrants);
            return {
              id: c.id,
              kind: c.kind,
              name: c.name,
              hole: c.hole,
              buyInCents: c.buyInCents,
              entryMode: modeOf(c.entryMode),
              entrantIds: m.entrants,
              winnerIds: c.entrants.filter((e) => e.won).map((e) => e.playerId),
              potCents: c.buyInCents * m.entrants.length,
              pending: m.pending.map((playerId) => ({
                playerId,
                name: nameOf(playerId),
              })),
              excluded: m.excluded.map((playerId) => ({ playerId, name: nameOf(playerId) })),
            };
          })}
          sideGames={sideGames.map((g) => {
            const m = potMembership(modeOf(g.entryMode), fieldIds, g.entrants);
            return {
            id: g.id,
            kind: g.kind,
            buyInCents: g.buyInCents,
            entryMode: modeOf(g.entryMode),
            /**
             * Confirmed stakes only — the same rule the contests follow, and
             * this was the one place not following it.
             *
             * A player putting their own name down from the app writes an
             * unconfirmed row: an intention, not a stake. Counting it here put
             * money in the pot that nobody had handed over, so the payout was
             * split more ways than there was cash.
             */
            entrantIds: m.entrants,
            // And who still owes, so there is somewhere to collect it from.
            pending: m.pending.map((playerId) => ({ playerId, name: nameOf(playerId) })),
            excluded: m.excluded.map((playerId) => ({ playerId, name: nameOf(playerId) })),
            };
          })}
          field={state.confirmed.map((p) => ({ id: p.id, name: p.name, playing: true }))}
        />
      )}
      <SkinsSeason rows={skinsSeason} />

      {/* The kitty, when this tournament keeps one. Below the pots because the
          pots are what people ask about on the day, and the kitty is what the
          organizer reconciles afterwards. */}
      {moneyMode === "float" && (
        <FloatClient
          lines={fundLines.map((l) => ({
            id: l.id,
            direction: l.direction,
            description: l.description,
            amountCents: l.amountCents,
            category: l.category,
            occurredOn: l.occurredOn,
            stageId: l.stageId,
            createdBy: l.createdBy,
          }))}
          rounds={weeks.map((s, i) => ({ id: s.id, label: `Round ${i + 1}` }))}
          canEdit={isStaff}
        />
      )}

      {/* The ledger, for the person collecting. The settle-up used to live
          only on the player screen, which works for an organizer who is also
          playing and fails completely for the one who is not — a society
          treasurer being the likeliest person to need it. */}
      {ledger && <OrganizerLedger view={ledger} />}

      {/* How money is handled at all, last: it is a setting, and a setting
          belongs under the thing it configures rather than above it. */}
      {isStaff && (
        <MoneySetup
          mode="tournament"
          eventMode={state.event.moneyMode}
          orgMode={org?.moneyMode ?? ""}
          orgKind={org?.kind ?? ""}
          clubName={org?.shortName || org?.name || ""}
        />
      )}
    </>
  );
}
