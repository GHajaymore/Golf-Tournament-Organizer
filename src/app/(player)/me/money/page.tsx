import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { moneyFor, roundMoneyFor, usesExpenses } from "@/lib/services/expenses";
import { MoneyClient } from "@/components/MoneyClient";
import { RoundMoney } from "@/components/RoundMoney";
import { prisma } from "@/lib/db";
import { resolveMoneyMode } from "@/lib/domain/money-mode";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { SideBetStart } from "@/components/SideBetStart";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";

/**
 * The player's money.
 *
 * Two things, in the order a player asks for them: what the pots paid, round
 * by round with the outing underneath — and then, only where the tournament
 * shares costs, what everybody owes.
 *
 * The pots come first for every kind of organization, because that is what a
 * player played for. The ledger is the part that depends on who is running the
 * golf: at a club the shop takes the entry fee and pays the winner, and a
 * settle-up there would invite a member to think the club owes them for the
 * buggy. See money-mode and org-profile.
 */
export default async function MoneyPage() {
  const session = await requireSession();

  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    select: {
      moneyMode: true,
      organization: { select: { moneyMode: true, kind: true } },
    },
  });
  if (!event) redirect("/me");

  const mode = resolveMoneyMode({
    eventMode: event.moneyMode,
    orgMode: event.organization?.moneyMode,
    orgKind: event.organization?.kind,
  });

  /**
   * Whether this screen exists, asked of `usesExpenses` — the SAME reader the
   * tab in (player)/layout.tsx uses.
   *
   * This used to be `if (mode === "none") redirect("/me")`, which is a second
   * implementation of the same rule and disagreed with the first the moment
   * the first learned about pots. A page that redirects while the tab says it
   * is there — or the reverse — is this codebase's oldest bug shape.
   */
  if (!(await usesExpenses(session.eventId))) redirect("/me");

  // The currency is no longer read here: it comes from the provider in the
  // player layout, the same one the organizer half has always used. Reading a
  // SYMBOL per page was how the two halves of one club drifted apart.

  const rounds = await roundMoneyFor(session.eventId, session.email);

  /**
   * The split ledger, whenever the tournament is on split. The MODE decides,
   * and nothing else.
   *
   * This also asked `layout.ledger`, which is the default for the kind of
   * outfit — and the kind has already had its say, as the fallback inside
   * resolveMoneyMode. Asking twice meant a club that deliberately set one
   * tournament to split got the tab (usesExpenses reads the mode) and then no
   * ledger on it: the override honoured in one place and overruled in the
   * other, which is worse than not offering it. A club running one society
   * day a year is exactly who needs this.
   */
  const ledger = mode === "split" ? await moneyFor(session.eventId, session.email, { name: session.name }) : null;
  if (!rounds.playerId && !ledger?.used) redirect("/me");

  /**
   * Starting a bet, from where a player already is.
   *
   * It lived only on the organizer's Group games screen, which is the one
   * place somebody standing on the first tee is not. A side bet is agreed in
   * the thirty seconds before a round and it has to be startable in that
   * thirty seconds, on a phone, from the screen a player already has open.
   *
   * Deliberately OUTSIDE the `mode === "split"` branch above. That mode
   * governs whether the club shares COSTS; a bet between four players is
   * their own money either way, and gating it on the club's expense setting
   * would hide it from exactly the clubs whose members bet most.
   */
  const state = await loadEventState(session.eventId);
  const playing = playingStages(state?.stages ?? []);

  /**
   * The round being played, and only that one.
   *
   * A side bet is agreed on the first tee about the round in front of you, so
   * the round is not a question worth asking — offering a picker would put a
   * choice in the way of the one answer that is nearly always right. A bet on
   * a different round is set up from that round's own screen.
   */
  const round = state?.activeStage ?? playing[playing.length - 1] ?? null;
  const bettable = round && playing.some((s) => s.id === round.id) ? round : null;

  /**
   * THE DRAW, only once the committee has published it.
   *
   * This is a PLAYER's screen, and it read `bettable.teeSheet` straight from
   * the round — so a draft draw, group names and who is in each group, was on
   * every player's phone the moment it was saved. A committee shuffling a
   * fourball had the shuffle read before they had decided it, and the whole
   * point of `teeSheetPublished` is that a saved sheet is not an announced one.
   *
   * `meFor` refuses this on Today, and the dashboard and the score-entry
   * screens both check the flag — this one page did not. Resolved once here
   * rather than at the two places below that used to parse it separately,
   * because two readers of one rule is how the second one comes to forget it.
   */
  const publishedSheet =
    bettable?.teeSheetPublished ? parseTeeSheet(bettable.teeSheet ?? "") : null;

  /**
   * Names already spoken for on this round, and by WHICH game.
   *
   * Per kind, because that is how a game is keyed: the same four players can
   * run skins AND a birdie pot under one name, and those two rows settle
   * together. Refusing the second was the check being too strict.
   */
  const taken = bettable
    ? [
        ...(
          await prisma.skinsPot.findMany({
            where: { stageId: bettable.id, groupKey: { not: "" } },
            select: { groupKey: true },
            distinct: ["groupKey"],
          })
        ).map((r) => ({ name: r.groupKey, kind: "skins" })),
        ...(
          await prisma.sideGame.findMany({
            where: { stageId: bettable.id, groupKey: { not: "" } },
            select: { groupKey: true, kind: true },
          })
        ).map((r) => ({ name: r.groupKey, kind: r.kind })),
        /**
         * AND EVERY TEE-SHEET GROUP NAME, reserved across all games.
         *
         * The organizer's screen did this and the player's did not, so a
         * player could name their bet after a fourball they are not in. The
         * server refuses it — `requirePotAccess` answers a tee-sheet name by
         * membership alone — but only after they have picked the game, named
         * it, ticked the people and pressed the button. A refusal you could
         * have shown while they were typing is a refusal in the wrong place.
         *
         * Reserved with `"*"` rather than per kind: an ad-hoc bet borrowing a
         * group's name would resolve its audience to that group, whatever
         * game it is.
         */
        ...(publishedSheet?.groups ?? []).map((g) => ({
          name: g.name,
          kind: "*",
        })),
      ]
    : [];

  const field = (state?.confirmed ?? [])
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <RoundMoney view={rounds} />
      {ledger && <MoneyClient view={ledger} />}
      {bettable && field.length > 1 && (
        <SideBetStart
          stageId={bettable.id}
          field={field}
          taken={taken}
          // The draw, so a player picks the people they are walking with rather
          // than scanning forty names for the three they know — once it has
          // been published. Before that they get the field, which is what this
          // screen showed anyway for a round with no sheet at all.
          groups={publishedSheet?.groups ?? []}
        />
      )}
    </div>
  );
}
