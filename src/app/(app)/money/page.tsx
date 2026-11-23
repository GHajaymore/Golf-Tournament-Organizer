import Link from "next/link";
import { redirect } from "next/navigation";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { roundLabel } from "@/lib/domain/round-label";
import { resolveMoneyMode } from "@/lib/domain/money-mode";
import { prizeTableHalf } from "@/lib/domain/money-parts";
import { previewQuery } from "@/lib/console-url";
import { groupGamesMovedTo } from "@/lib/domain/group-games-door";
import { potStatusLine } from "@/lib/domain/pot-status";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { keepingPreview, previewModeNow, screensShownFor } from "@/lib/services/screens-shown";
import { potStatusFor, settleHalfFor } from "@/lib/services/money-settle";
import { prizeFieldFor } from "@/lib/services/prize-field";
import { PrizesClient } from "@/components/PrizesClient";
import { MoneyModeLine } from "@/components/MoneyModeLine";
import { SettleHalf } from "@/components/money/SettleHalf";
import { GroupGames } from "@/components/money/GroupGames";

/**
 * WINNERS & MONEY (R8b, the redesign): who won what and who owes whom. The settle half of a tournament's money
 * (`domain/money-parts.ts`), drawn only while its screen is shown (`screensShownFor`, `?stepper=1&build=1` today and never in
 * production); otherwise the address sends a person to Prizes & payouts, where all of it has always been, so the address is
 * harmless while the redesign is switched off. The page opens with exactly that guard, the shape the signed-out sweep and the
 * screen walks recognise (`isSwitchedOff`).
 *
 * WHAT IS ON IT: who won each prize (the prize table's winner half), the season's skins, the kitty or the ledger, and the groups'
 * own games as a section. What is OFFERED stays on Prizes & side games, and so does each pot's and contest's own card (who is in
 * it, who has paid their stake, who won): that card is mounted once, and these controls are drawn with it (`moneyScreenOf`).
 *
 * FINAL ONLY, NEVER LIVE. No figure is worked out here: the ledger and the season come through the sinks (`settleHalfFor`:
 * `gameNets`, which answers nothing for a game that can still change). TourneyHQ works money out and records it. It never moves it.
 *
 * The browser-tab title is the menu's word for the door (`nav-lifecycle.ts`): `nav.ts` holds no row for a screen that is not in the
 * menu yet, so it is named here.
 */
export const generateMetadata = () => ({ ...screenMetadata("/money"), title: "Winners & money" });

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string }>;
}) {
  const session = await requireScreen("prizes");
  const shown = await screensShownFor(session);
  if (!shown.has("money")) redirect("/prizes");

  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const params = await searchParams;
  const isStaff = session.role === "admin" || session.role === "assistant";
  const weeks = playingStages(state.stages);

  const org = await prisma.organization.findUnique({
    where: { id: state.event.organizationId },
    select: { name: true, shortName: true, kind: true, country: true, communityNoun: true, moneyMode: true },
  });
  const moneyMode = resolveMoneyMode({ eventMode: state.event.moneyMode, orgMode: org?.moneyMode, orgKind: org?.kind });

  const prizes = await prisma.prize.findMany({ where: { eventId: session.eventId }, orderBy: { position: "asc" } });
  const prizeField = prizeFieldFor(state);
  const settle = await settleHalfFor({ eventId: session.eventId, email: session.email, name: session.name, isStaff, moneyMode });

  // How far the field's pots and contests have got: a count of stored rows, never an amount (`pot-status.ts`).
  const potStatus = potStatusLine(await potStatusFor(session.eventId));
  const sideGamesHref = await keepingPreview("/prizes#side-games");
  const setupHref = await keepingPreview("/prizes#money-setup");
  const offerHref = await keepingPreview("/prizes");
  const mode = await previewModeNow();
  const carry = mode ? previewQuery(mode) : undefined;
  // The groups' games are drawn here only where the one rule says they moved here (`relocate`, through the door's helper); a tournament's
  // staff always are, this screen being a tournament's. Otherwise the old screen keeps them and this points at it.
  const groupsHere = groupGamesMovedTo(session.viewRole, false, shown, params.round) !== null;

  return (
    <>
      <div style={{ marginBottom: 20 }} data-money-screen="">
        <div className="page-kicker">Results</div>
        <h1 className="page-title">Winners &amp; money</h1>
        <p className="page-sub" style={{ marginTop: 6 }}>
          Who won what and who owes whom. Amounts that can still change appear once they are final.{" "}
          <strong>TourneyHQ works out and records who is owed what. It does not pay anyone.</strong>
        </p>
      </div>
      <MoneyModeLine
        eventMode={state.event.moneyMode}
        orgMode={org?.moneyMode ?? ""}
        orgKind={org?.kind ?? ""}
        orgCountry={org?.country ?? ""}
        orgNoun={org?.communityNoun ?? ""}
        clubName={org?.shortName || org?.name || ""}
        href={isStaff ? setupHref : undefined}
      />

      <PrizesClient
        part={prizeTableHalf("money", true)}
        prizes={prizes.map((p) => ({
          id: p.id,
          category: p.category,
          detail: p.detail,
          amount: p.amount,
          winnerId: p.winnerId,
          counts: p.countsForOnePrize,
        }))}
        players={prizeField.players}
        flights={prizeField.flights}
        byScore={prizeField.byScore}
        onePrizePerPlayer={state.event.onePrizePerPlayer}
        offerHref={offerHref}
      />

      {/* A pot or contest is ONE card, mounted once, and it is drawn on Prizes & side games with its own people, stakes and winners.
          A second copy here would be a pot set on one card and read on the other, so this says how far the cards have got (a count
          of stored rows, nothing live) and links to the card itself. */}
      <section className="card elev-sm" style={{ marginTop: 16 }} aria-label="Pots and contests">
        <span className="card-title" style={{ fontSize: 14 }}>
          Pots and contests
        </span>
        <p data-pot-status="" style={{ margin: "6px 0 0", fontSize: 14, fontWeight: 600 }}>
          {potStatus}
        </p>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.6 }}>
          Who is in each pot, who has paid their stake and who won a closest-to-the-pin or long drive are kept on that game&rsquo;s own card.{" "}
          <Link href={sideGamesHref}>Open the pots and contests</Link>
        </p>
      </section>

      <SettleHalf
        settle={settle}
        moneyMode={moneyMode}
        rounds={weeks.map((s) => ({ id: s.id, label: roundLabel(weeks, s.id) }))}
        isStaff={isStaff}
      />

      {/* The groups' own games, a section of this screen for a tournament's staff (`MOVES`: `/group-games` leads here). The same
          body `/group-games` draws, mounted once per state: that screen points here while this one is shown. The section draws a
          group's own pot and contest cards, so it is the one place on this screen with offer controls for a group's game. */}
      <div style={{ marginTop: 24 }}>
        {groupsHere ? (
          <GroupGames session={session} round={params.round} asSection carry={carry} />
        ) : (
          <p className="text-muted" style={{ fontSize: 13.5 }}>
            The groups&rsquo; side games are kept on <Link href="/group-games">Side games</Link>.
          </p>
        )}
      </div>
    </>
  );
}
