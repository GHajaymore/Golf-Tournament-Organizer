import Link from "next/link";
import { redirect } from "next/navigation";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { roundLabel } from "@/lib/domain/round-label";
import { resolveMoneyMode } from "@/lib/domain/money-mode";
import { prizeTableHalf } from "@/lib/domain/money-parts";
import { STEPPER_PREVIEW } from "@/lib/domain/lifecycle-track";
import { BUILD_PREVIEW } from "@/lib/domain/console-merges";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { keepingPreview, previewModeNow, screensShownFor } from "@/lib/services/screens-shown";
import { settleHalfFor } from "@/lib/services/money-settle";
import { prizeFieldFor } from "@/lib/services/prize-field";
import { PrizesClient } from "@/components/PrizesClient";
import { MoneyModeLine } from "@/components/MoneyModeLine";
import { SettleHalf } from "@/components/money/SettleHalf";
import { GroupGames } from "@/components/money/GroupGames";

/**
 * WINNERS & MONEY (R8b, the redesign): who won what and who owes whom, once it is final. The settle half of a tournament's money
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

  const sideGamesHref = await keepingPreview("/prizes#side-games");
  const setupHref = await keepingPreview("/prizes#money-setup");
  const mode = await previewModeNow();
  const carry = mode === "build" ? `${STEPPER_PREVIEW}=1&${BUILD_PREVIEW}=1` : mode === "preview" ? `${STEPPER_PREVIEW}=1` : undefined;

  return (
    <>
      <div style={{ marginBottom: 20 }} data-money-screen="">
        <div className="page-kicker">Results</div>
        <h1 className="page-title">Winners &amp; money</h1>
        <p className="page-sub" style={{ marginTop: 6 }}>
          Who won what and who owes whom, shown once it is final.{" "}
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
      />

      {/* Said where it is looked for: a pot or contest is ONE card, mounted once, and it is drawn on Prizes & side games with
          its own people and winners. A second copy here would be a pot set on one card and read on the other. */}
      <section className="card elev-sm" style={{ marginTop: 16 }} aria-label="Pots and contests">
        <span className="card-title" style={{ fontSize: 14 }}>
          Pots and contests
        </span>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.6 }}>
          Who is in each pot, who has paid their stake and who won a closest-to-the-pin or long drive are kept on that game&rsquo;s own card,
          on <Link href={sideGamesHref}>Prizes &amp; side games</Link>, with the prize list and the stakes.
        </p>
      </section>

      <SettleHalf
        settle={settle}
        moneyMode={moneyMode}
        rounds={weeks.map((s) => ({ id: s.id, label: roundLabel(weeks, s.id) }))}
        isStaff={isStaff}
      />

      {/* The groups' own games, a section of this screen for a tournament's staff (`MOVES`: `/group-games` leads here). The same
          body `/group-games` draws, mounted once per state: that screen sends staff here while this one is shown. */}
      <div style={{ marginTop: 24 }}>
        <GroupGames session={session} round={params.round} asSection carry={carry} />
      </div>
    </>
  );
}
