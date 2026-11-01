import "server-only";
import { prisma } from "../db";
import type { EventState } from "./tournament";
import { loadEventState, playingStages } from "./tournament";
import { movementBetween } from "../domain/week-movement";
import { directionOnBasis, valueOnBasis } from "../domain/week-basis";
import { roundStrokes } from "./round-cards";
import { weekViewFor } from "./week-view";
import { skinsPotFor } from "./skins-pot";
import { moneyFor, sidePotOutcomes, type SidePotOutcome } from "./expenses";
import { nassauBoard } from "./points-standings";
import { formattingForEvent } from "./organization";
import { formatDay, formatMoney, type Formatting } from "../domain/locale";
import { minorUnitDigits } from "../domain/money-format";
import { resolveMoneyMode, floatSummary } from "../domain/money-mode";
import { isSkinsScope, skinsGameLabel } from "../domain/skins-pot";
import { DERIVED_LABEL, isDerivedKind } from "../domain/derived-games";
import { roundLabel } from "../domain/round-label";
import { holesPlayed } from "../domain/handicap";
import { sharedBallRound } from "../domain/shared-ball";
import { cleanIsoDate, shortDate } from "../domain/round-dates";
import { parseDeadlineIso } from "../deadline";
import { registrationStatus } from "../registration";
import { clubDay } from "../domain/club-clock";
import { isManualFormat, needsTeams } from "../formats";
import { roundIsStroke } from "../stage-types";
import { listWords } from "../domain/final-report";
import { plural } from "../format";
import { byAddress } from "../domain/my-entry";
import type { HighlightRound } from "../domain/report-highlights";
import type { MovementRound } from "../domain/report-movement";
import type { WeekBasis } from "../domain/week-basis";

/**
 * THE PARTS OF THE FINAL REPORT THAT OTHER SCREENS ALREADY HOLD (2026-10-21).
 *
 * Ajay: "THE REPORT CAN INCLUDE EVERYTHING THE TOURNAMENT IS USING INCLUDING
 * MONEY … whatever we build should come from real app". So each section here
 * is a READ of the reader the screen holding it uses, and nothing is worked
 * out a second time:
 *
 *   the cards           `roundStrokes` — every card table at once — against
 *                       `state.strokeCourseFor(stageId)`, each round's own card
 *   the movement        `weekViewFor`, the week sheet's standings after each round
 *   skins               `skinsPotFor`, the pot's own service
 *   side games          `sidePotOutcomes` (the pass that pays the players) and
 *                       `nassauBoard`
 *   costs and the fund  `moneyFor`'s expenses, `floatSummary` over the fund
 *   settle-up           `moneyFor(...).transfers`, the money screen's own list
 *   coming up           the rounds' dates, `registrationStatus`, pinned notices
 *
 * MONEY IS FINAL ONLY, and that is enforced where it already is — at the sink.
 * `skinsPotFor` marks a half-played pot `provisional` and it is left out here
 * exactly as `gameNets` leaves it out of the settle-up; `sidePotOutcomes` holds
 * no pot that is not final. So nothing in this file can report a pot the money
 * screen would not.
 */

/** Who the report is for — and so whether it carries amounts. */
export type ReportAudience =
  /** The organizer's copy, in Reports. Amounts, and the whole settle-up. */
  | { kind: "staff"; email: string }
  /** Somebody in the field, signed in. Amounts, their own line first. */
  | { kind: "player"; email: string }
  /** The public link. Winners, never what they won; no settle-up. */
  | { kind: "public" };

/**
 * The audience a viewer gets: staff in the console; a signed-in person with a
 * row in this tournament's field; and everybody else the public copy.
 */
export async function reportAudienceFor(
  eventId: string,
  viewer: { email: string; staff: boolean } | null,
): Promise<ReportAudience> {
  const email = (viewer?.email ?? "").trim();
  if (!viewer || !email) return { kind: "public" };
  if (viewer.staff) return { kind: "staff", email };
  const inField = await prisma.player.findFirst({ where: { eventId, ...byAddress(email) }, select: { id: true } });
  return inField ? { kind: "player", email } : { kind: "public" };
}

export const showsAmounts = (a: ReportAudience): boolean => a.kind !== "public";

/* ------------------------------------------------------------------------ */
/*  The cards, for the highlights                                            */
/* ------------------------------------------------------------------------ */

/**
 * Every round's cards in the shape `reportHighlights` reads. A round scored by
 * hand files nothing worth reading, and a shared-ball round files a SIDE's
 * card with nobody's name on it — `roundStrokes` already refuses that card, and
 * the round is left out here so nothing counts a birdie for a person who did
 * not hit it. A disputed card can still change, so it is not read either.
 */
export async function highlightRoundsFor(state: EventState): Promise<HighlightRound[]> {
  const stages = playingStages(state.stages).filter((s) => !isManualFormat(s.format) && !sharedBallRound(s.format));
  if (stages.length === 0) return [];
  const rows = await roundStrokes(state.event.id);
  const nameOf = new Map(state.players.map((p) => [p.id, p.name]));
  return stages.map((stage) => {
    const holes = holesPlayed(stage.holes);
    const card = state.strokeCourseFor(stage.id);
    return {
      stageId: stage.id,
      label: roundLabel(state.stages, stage.id) || stage.description || "Round",
      holes,
      firstHole: holes === 9 && stage.nine === "back" ? 10 : 1,
      // Already the nine played, re-ranked — `strokeCourseFor` narrows it.
      pars: card.pars,
      strokePlay: roundIsStroke(stage.type, stage.format) && !needsTeams(stage.format),
      venue: stage.courseId ?? "",
      cards: rows
        .filter((r) => r.stageId === stage.id && !r.disputed)
        .flatMap((r) => {
          try {
            const strokes = JSON.parse(r.strokes) as (number | null)[];
            return Array.isArray(strokes) ? [{ playerId: r.playerId, name: nameOf.get(r.playerId) ?? "", strokes }] : [];
          } catch {
            return [];
          }
        })
        .filter((c) => c.name),
    };
  });
}

/** The names of the courses a hole can be at, for a tournament played at more than one. */
export async function venueNames(state: EventState, ids: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(Boolean))];
  const rows = wanted.length
    ? await prisma.course.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } })
    : [];
  return new Map([["", state.event.course.trim()], ...rows.map((r) => [r.id, r.name] as [string, string])]);
}

/* ------------------------------------------------------------------------ */
/*  The movement                                                             */
/* ------------------------------------------------------------------------ */

/**
 * THE TABLE AFTER EACH ROUND, from the reader that already answers it.
 *
 * A STROKE BOARD: the board itself, ranked on the rounds up to that one —
 * `loadEventState(eventId, throughStageId)`, the reading the CUT is made on
 * (`applyStrokeCut`), with the board's own places and countback. Only players
 * who hold a place: somebody who missed the cut, withdrew or has no card is not
 * "top" of anything. Its last table is the board's final one, so the Final
 * column and the champion cannot disagree with the story.
 *
 * Not the week sheet's stroke table, which this first read: it adds up whatever
 * cards each player has and ranks the totals, which in a championship with a
 * cut put eighteen-hole totals above thirty-six-hole ones and told the story of
 * a round two "led" by twelve players who were not in it (walked on the seeded
 * club, 2026-10-21, before this shipped).
 *
 * A MATCH LEAGUE: the week sheet's table (`weekViewFor`), which chains the
 * match points exactly as the board does — only the rounds whose result is in
 * that table (`standingsIncludeThisWeek`), since a medal night earns no match
 * points and a column for it would repeat the round before.
 */
export async function movementRoundsFor(
  state: EventState,
  basis: WeekBasis,
): Promise<{ rounds: MovementRound[]; basis: WeekBasis | null }> {
  const rounds: MovementRound[] = [];
  const label = (stage: { id: string; description: string }) => roundLabel(state.stages, stage.id) || stage.description || "Round";

  if (state.boardIsStroke) {
    const dir = directionOnBasis(basis);
    let before: Array<{ playerId: string; name: string; value: number; rank: number }> = [];
    for (const stage of state.strokeRounds) {
      /**
       * A ROUND NOBODY HAS PLAYED IS NOT A TABLE (walked 2026-10-23). The
       * board "through" a future week is the board through the last week
       * played, so the seeded league read "Wallace Ferrity stayed top after
       * Round 5 … Round 6 … Round 7" with three weeks still on the calendar.
       */
      if (!state.roundsWithResults.has(stage.id)) continue;
      const through = await loadEventState(state.event.id, stage.id);
      if (!through) continue;
      const rows = through.strokeStandings
        .filter((s) => s.ranked && s.thru > 0)
        .map((s) => ({
          playerId: s.player.id,
          name: s.player.name,
          value: valueOnBasis(basis, { gross: s.gross, net: s.net, points: s.points }),
          rank: s.rank,
        }));
      if (rows.length === 0) continue;
      rounds.push({ label: label(stage), rows: movementBetween(rows, before, dir) });
      before = rows;
    }
    return { rounds, basis };
  }

  let found: WeekBasis | null = null;
  for (const stage of playingStages(state.stages)) {
    if (!state.roundsWithResults.has(stage.id)) continue;
    const view = await weekViewFor(state.event.id, stage.id);
    if (!view || view.stageId !== stage.id || !view.standingsIncludeThisWeek || view.standings.length === 0) continue;
    found = view.basis;
    rounds.push({ label: label(stage), rows: view.standings });
  }
  return { rounds, basis: found };
}

/* ------------------------------------------------------------------------ */
/*  Money                                                                    */
/* ------------------------------------------------------------------------ */

export interface MoneyLine {
  what: string;
  amount: string;
}

export interface ReportPot {
  title: string;
  /** "$5 each, 4 in: a $20 pot. 3 skins won." — with no amounts on the public copy. */
  line: string;
  winners: Array<{ name: string; detail: string; amount: string }>;
}

export interface ReportMoney {
  skins: ReportPot[];
  sideGames: ReportPot[];
  /** Entry fees, the fund and shared costs — absent from the public copy. */
  costs: { lines: MoneyLine[]; total: MoneyLine | null } | null;
  /** The fewest payments. Absent from the public copy. */
  settleUp: { yours: string; lines: Array<{ from: string; to: string; amount: string }> } | null;
  /** What each contest's pot held, by contest id — staff and the field only. */
  contestPots: Map<string, number>;
  /** A prize's amount, in the club's words. "" on the public copy, or for a prize with none. */
  prizeAmount: (amount: number) => string;
  money: (cents: number) => string;
}

const FUND_WORDS: Record<string, string> = {
  "entry-fee": "Entry fees",
  sponsor: "Sponsors",
  raffle: "Raffle",
  prize: "Prizes",
  trophy: "Trophies",
  catering: "Catering",
  "green-fee": "Green fees",
};

/** "holes 4 and 13", "hole 2". */
function holesWords(holes: number[]): string {
  if (holes.length === 0) return "";
  return `${holes.length === 1 ? "hole" : "holes"} ${listWords(holes.map(String))}`;
}

export async function moneySections(state: EventState, audience: ReportAudience): Promise<ReportMoney> {
  const eventId = state.event.id;
  const amounts = showsAmounts(audience);
  const f: Formatting = await formattingForEvent(eventId);
  const money = (cents: number) => formatMoney(cents, f);
  const stages = playingStages(state.stages);
  const several = stages.length > 1;
  const named = (title: string, stageId: string) => (several ? `${title}, ${roundLabel(state.stages, stageId)}` : title);

  // ── Skins: the club's pots, final ones only ──────────────────────────────
  const pots = await prisma.skinsPot.findMany({
    where: { eventId, groupKey: "" },
    orderBy: [{ createdAt: "asc" }],
    select: { stageId: true, net: true, scope: true },
  });
  const skins: ReportPot[] = [];
  for (const pot of pots) {
    const stage = stages.find((s) => s.id === pot.stageId);
    if (!stage) continue;
    const scope = isSkinsScope(pot.scope) ? pot.scope : "full";
    const view = await skinsPotFor(eventId, pot.stageId, pot.net, scope, "");
    // Final only — the same flag `gameNets` refuses a pot on.
    if (!view?.result || view.result.provisional) continue;
    const r = view.result;
    const won = `${plural(r.claimedSkins, "skin")} won${r.unclaimedSkins > 0 ? `; ${plural(r.unclaimedSkins, "hole")} shared and carried` : ""}.`;
    const stake =
      view.buyInCents > 0
        ? `${money(view.buyInCents)} each, ${r.playerCount} in: a ${money(r.potCents)} pot. `
        : view.stakeNote.trim()
          ? `Played for ${view.stakeNote.trim()}. `
          : "";
    skins.push({
      title: named(skinsGameLabel(pot.net, scope, holesPlayed(stage.holes)), stage.id),
      line: `${amounts ? stake : `${r.playerCount} in. `}${won}`,
      winners: r.shares
        .filter((s) => s.skins > 0)
        .sort((a, b) => b.skins - a.skins || b.wonCents - a.wonCents)
        .map((s) => ({
          name: view.nameById[s.playerId] ?? "",
          detail: holesWords(view.holes.filter((h) => h.playerId === s.playerId).map((h) => h.hole)),
          amount: amounts && view.buyInCents > 0 ? money(s.wonCents) : "",
        })),
    });
  }

  // ── Side games: the pots the cards settle, and the Nassau ────────────────
  const games = await prisma.sideGame.findMany({
    where: { eventId, groupKey: "" },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, stageId: true, kind: true, buyInCents: true },
  });
  const nameOf = new Map(state.players.map((p) => [p.id, p.name]));
  const sideGames: ReportPot[] = [];
  const results = new Map<string, Map<string, SidePotOutcome>>();
  for (const g of games) {
    const stage = stages.find((s) => s.id === g.stageId);
    if (!stage) continue;
    if (g.kind === "nassau") {
      const rows = await nassauBoard(eventId, g.stageId);
      const words = (w: string | null | undefined, a: string, b: string) => (w === "A" ? a : w === "B" ? b : w === "H" ? "halved" : "");
      const lines = rows.flatMap((row) => {
        const decided = row.outcome.segments.filter((s) => s.result?.complete);
        if (decided.length === 0) return [];
        const parts = decided.map((s) => {
          const who = words(s.result?.winner, row.aName, row.bName);
          return who === "halved" ? `${s.label.toLowerCase()} halved` : `${s.label.toLowerCase()} to ${who}`;
        });
        return [{ name: `${row.aName} v ${row.bName}`, detail: parts.join(", "), amount: "" }];
      });
      if (lines.length > 0) {
        sideGames.push({
          title: named("Nassau", stage.id),
          line: amounts && g.buyInCents > 0 ? `${money(g.buyInCents)} on each nine and the match. What it came to is in the settle-up.` : "",
          winners: lines,
        });
      }
      continue;
    }
    if (!isDerivedKind(g.kind)) continue;
    if (!results.has(g.stageId)) results.set(g.stageId, await sidePotOutcomes(eventId, g.stageId));
    const outcome = results.get(g.stageId)?.get(g.id);
    // Absent until the round is final — `sidePotOutcomes` holds nothing else.
    // PRESENT WITH NO NETS when nobody won and every stake went back, which is
    // a result and is reported; and the count in it is the pot's ENTRANTS, not
    // the players its money moved (2026-10-23 — see `SidePotOutcome`).
    if (!outcome || outcome.entrants === 0) continue;
    const up = outcome.nets.filter((n) => n.netCents > 0).sort((a, b) => b.netCents - a.netCents);
    sideGames.push({
      title: named(DERIVED_LABEL[g.kind], stage.id),
      line: amounts
        ? `${money(g.buyInCents)} each, ${outcome.entrants} in: a ${money(outcome.potCents)} pot.${up.length === 0 ? " Nobody won it; the stakes went back." : ""}`
        : `${outcome.entrants} in.${up.length === 0 ? " Nobody won it." : ""}`,
      winners: up.map((n) => ({
        name: nameOf.get(n.playerId) ?? "",
        detail: "",
        amount: amounts ? `up ${money(n.netCents)}` : "",
      })),
    });
  }

  // ── Fees, costs, the fund, the settle-up: amounts only, so never public ──
  let costs: ReportMoney["costs"] = null;
  let settleUp: ReportMoney["settleUp"] = null;
  const contestPots = new Map<string, number>();
  if (amounts) {
    const email = audience.kind === "public" ? "" : audience.email;
    const view = await moneyFor(eventId, audience.kind === "player" ? email : "");
    for (const c of view.contests) if (c.decided && c.potCents > 0) contestPots.set(c.id, c.potCents);

    const org = await prisma.organization.findUnique({
      where: { id: state.event.organizationId },
      select: { moneyMode: true, kind: true },
    });
    const mode = resolveMoneyMode({ eventMode: state.event.moneyMode, orgMode: org?.moneyMode, orgKind: org?.kind });
    if (mode === "float") {
      const fund = await prisma.tournamentFund.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } });
      if (fund.length > 0) {
        const groups = new Map<string, typeof fund>();
        for (const l of fund) {
          const what = FUND_WORDS[l.category] ?? (l.description.trim() || "Other");
          const key = `${l.direction === "in" ? "in" : "out"}\u0000${what}`;
          groups.set(key, [...(groups.get(key) ?? []), l]);
        }
        const lines: MoneyLine[] = [...groups.entries()]
          .sort(([a], [b]) => (a.startsWith("in") === b.startsWith("in") ? 0 : a.startsWith("in") ? -1 : 1))
          .map(([key, ls]) => {
            const s = floatSummary(ls.map((l) => ({ direction: l.direction === "in" ? "in" : "out", amountCents: l.amountCents })));
            const what = key.split("\u0000")[1];
            return s.outCents > 0 ? { what, amount: `−${money(s.outCents)}` } : { what, amount: money(s.inCents) };
          });
        const all = floatSummary(fund.map((l) => ({ direction: l.direction === "in" ? "in" : "out", amountCents: l.amountCents })));
        costs = {
          lines,
          total: {
            what: all.shortfall ? "Out of pocket" : "Left in the fund",
            amount: all.shortfall ? `−${money(Math.abs(all.balanceCents))}` : money(all.balanceCents),
          },
        };
      }
    } else if (mode === "split" && view.expenses.length > 0) {
      costs = {
        lines: view.expenses.map((e) => ({ what: e.description, amount: money(e.amountCents) })),
        total: { what: "Shared costs", amount: money(view.expenses.reduce((s, e) => s + e.amountCents, 0)) },
      };
    }

    if (view.transfers.length > 0) {
      let yours = "";
      if (audience.kind === "player" && view.playerId) {
        const pays = view.transfers.filter((t) => t.fromPlayerId === view.playerId);
        const gets = view.transfers.filter((t) => t.toPlayerId === view.playerId);
        if (pays.length > 0) {
          yours = `You pay ${listWords(pays.map((t) => `${money(t.cents)} to ${t.toName}`))}.`;
        } else if (gets.length > 0) {
          yours = `You are owed ${money(gets.reduce((s, t) => s + t.cents, 0))}: ${listWords(gets.map((t) => `${t.fromName} pays you ${money(t.cents)}`))}.`;
        } else {
          yours = "You are square: nothing to pay and nothing owed.";
        }
      }
      settleUp = {
        yours,
        lines: view.transfers.map((t) => ({ from: t.fromName, to: t.toName, amount: money(t.cents) })),
      };
    }
  }

  return {
    skins,
    sideGames,
    costs,
    settleUp,
    contestPots,
    prizeAmount: (amount: number) =>
      amounts && amount > 0 ? money(Math.round(amount * 10 ** minorUnitDigits(f.currency))) : "",
    money,
  };
}

/* ------------------------------------------------------------------------ */
/*  Coming up                                                                */
/* ------------------------------------------------------------------------ */

/**
 * WHAT IS NEXT, from the club's own schedule: this tournament's next round,
 * the last day to play a round with a deadline, the club's other tournaments
 * taking entries (through `registrationStatus`, the rule the entry form keeps)
 * and — for the field and the organizer, not the public link — the pinned
 * notices. Every day is the CLUB's (`state.today`), written the club's way.
 */
export async function comingUpFor(state: EventState, audience: ReportAudience): Promise<Array<{ when: string; text: string }>> {
  const today = state.today;
  const { locale } = await formattingForEvent(state.event.id);
  const dated: Array<{ iso: string; text: string }> = [];

  const next = playingStages(state.stages).find((s) => {
    const iso = cleanIsoDate(s.playedOn);
    return iso && iso >= today && !state.roundsWithResults.has(s.id) && s.closedAt == null;
  });
  if (next) {
    dated.push({ iso: cleanIsoDate(next.playedOn), text: `${roundLabel(state.stages, next.id) || "The next round"} of ${state.event.name}.` });
  }
  for (const s of playingStages(state.stages)) {
    const iso = parseDeadlineIso(s.deadline ?? "");
    if (iso && iso >= today && s.closedAt == null) {
      dated.push({ iso, text: `The last day to play ${roundLabel(state.stages, s.id) || "the round"}.` });
    }
  }

  if (state.event.organizationId) {
    const others = await prisma.event.findMany({
      where: {
        organizationId: state.event.organizationId,
        id: { not: state.event.id },
        // Not finished: the three setting-up statuses read as one (G1); the
        // published link below is what says entries are taken.
        status: { notIn: ["completed"] },
        registrationOpen: true,
      },
      select: {
        id: true,
        name: true,
        status: true,
        regDeadline: true,
        regOpens: true,
        capacity: true,
        registrationOverride: true,
        startOn: true,
        organization: { select: { timeZone: true } },
        _count: { select: { players: { where: { status: "confirmed" } } } },
      },
    });
    for (const e of others) {
      const status = registrationStatus({
        eventStatus: e.status,
        deadline: e.regDeadline,
        opens: e.regOpens,
        capacity: e.capacity,
        confirmedCount: e._count.players,
        override: e.registrationOverride,
        now: clubDay(e.organization?.timeZone),
        locale,
      });
      // One line a tournament: the day entries close, and the day it is played.
      const closes = parseDeadlineIso(e.regDeadline);
      if (status.acceptingEntries && closes && closes >= today) {
        const starts = cleanIsoDate(e.startOn);
        const played = starts && starts >= closes ? `; it is played on ${shortDate(starts, locale) || formatDay(starts, locale)}` : "";
        dated.push({ iso: closes, text: `Entries close for ${e.name}${played}.` });
      }
    }
  }

  // The nearest three: a document's "what's next", not the club's calendar.
  const out = dated
    .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0))
    .slice(0, 3)
    .map((d) => ({ when: shortDate(d.iso as Parameters<typeof shortDate>[0], locale) || formatDay(d.iso, locale), text: d.text }));

  if (audience.kind !== "public") {
    const pinned = await prisma.announcement.findMany({
      where: { eventId: state.event.id, pinned: true },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { title: true, body: true },
    });
    for (const a of pinned) {
      const body = a.body.trim();
      out.push({ when: "Notice", text: body ? `${a.title.trim()}. ${body}` : a.title.trim() });
    }
  }
  return out;
}
