import { TOURNAMENT_TEMPLATES, suggestedFor, type TournamentTemplate } from "../tournament-templates";
import { TOURNAMENT_SHAPES } from "../tournament-shape";

/**
 * WHAT "START FROM" OFFERS, FOR BOTH FORMS THAT ASK IT.
 *
 * There are two create-a-tournament forms — `CreateFirstTournament` on the
 * picker and `EventSwitcher` on the dashboard — and they had grown two
 * different answers to the same question.
 *
 * `EventSwitcher` offered "Copy an existing tournament" over a flat,
 * unsorted list of all eleven templates. `CreateFirstTournament` offered a
 * "Suggested" group and then the whole list again grouped by side size — so
 * SEVEN of its eleven entries appeared TWICE, and it never offered a copy at
 * all. Read off the screen on 2026-09-11: eleven starting points rendered as
 * seventeen options, and the organizer's own last season not among them.
 *
 * THREE RULES, and the first is the one that matters most.
 *
 * A TOURNAMENT THIS CLUB HAS ALREADY RUN IS THE BEST STARTING POINT THERE IS.
 * It has the club's own rounds, formats, courses and settings in it, decided
 * by somebody who knows the golf — which no template can. So the copies come
 * first, ahead of every template, wherever there are any. That is the "learn
 * from the tournaments" half, and it is why this is not just a sort.
 *
 * EVERY TEMPLATE APPEARS EXACTLY ONCE. The suggested ones are a group at the
 * top rather than a duplicate of rows further down; a picker that lists the
 * same thing twice makes somebody wonder what the difference is.
 *
 * THE BLANK ONE IS LAST AND UNGROUPED. It is not a kind of golf, so it heads
 * nothing and belongs under everything.
 *
 * Derived here rather than in either component so the two cannot drift again —
 * which is the whole reason this file exists rather than a tidy-up of each.
 */

/**
 * Marks a value as an event id rather than a template key, so the two
 * namespaces share one `<select>` without colliding.
 *
 * Was a private constant in `EventSwitcher`. Moved because the other form
 * needs it too, and a second copy of a prefix is a second chance to write
 * `copy_` in one place and `copy:` in the other.
 */
export const COPY_PREFIX = "copy:";

/** The `<select>` value that means "copy this tournament". */
export function copyValue(eventId: string): string {
  return `${COPY_PREFIX}${eventId}`;
}

/**
 * The event id a value names, or "" when it names a template.
 *
 * Returns "" rather than null so a caller can use it as a plain truthiness
 * test — `if (copiedEventId(v))` — and never accidentally pass the string
 * "null" to an action.
 */
export function copiedEventId(value: string): string {
  return value.startsWith(COPY_PREFIX) ? value.slice(COPY_PREFIX.length) : "";
}

/** One tournament this organizer may copy. Only what the picker shows. */
export interface CopyableEvent {
  id: string;
  name: string;
}

export interface StartFromOption {
  value: string;
  label: string;
}

export interface StartFromGroup {
  /** "" means render the options with no heading — see the blank template. */
  label: string;
  options: StartFromOption[];
}

/**
 * How many of the organizer's own tournaments to offer.
 *
 * A club with nine seasons behind it would otherwise push every template below
 * the fold of a `<select>`, which turns "we also have starting points" into
 * "there are none". Six is about a season of monthly medals — enough that the
 * one somebody means is almost always there, short enough that the templates
 * are still visible without scrolling.
 *
 * The list is expected NEWEST FIRST, because the tournament somebody wants to
 * repeat is nearly always the last one they ran.
 */
export const MAX_COPYABLE_OFFERED = 6;

const SHAPE_LABEL = new Map(TOURNAMENT_SHAPES.map((s) => [s.key as string, s.label]));

/**
 * The groups a "Start from" select should render, in order.
 *
 * `shape` is the answer to "How is it played?" and is "" until it is given —
 * in which case there is nothing to suggest, and the suggested group simply
 * does not appear rather than heading an empty list.
 */
/** One template as a `<select>` option. */
const optionFor = (t: TournamentTemplate): StartFromOption => ({ value: t.key, label: t.name });

export function startFromGroups(input: {
  /** This organizer's own tournaments, NEWEST FIRST. */
  copyable?: CopyableEvent[];
  /** single | series | knockout, or "" before the question is answered. */
  shape?: string;
  /**
   * club | community | personal, or "" when it is not known yet.
   *
   * ORDERS the templates and never filters them — see the suggested group.
   * Empty leaves the order exactly as it was before this existed, which is
   * what a session with no organization resolved yet should see.
   */
  orgKind?: string;
}): StartFromGroup[] {
  const groups: StartFromGroup[] = [];

  const copyable = (input.copyable ?? []).slice(0, MAX_COPYABLE_OFFERED);
  if (copyable.length > 0) {
    groups.push({
      // Says whose, because the group below it is the app's suggestions and
      // the difference between "ours" and "yours" is the whole point of it.
      label: "Copy one of yours",
      options: copyable.map((e) => ({
        value: copyValue(e.id),
        // An untitled draft is a real row and must still be pickable — a blank
        // option is one nobody can choose on purpose.
        label: e.name.trim() || "Untitled tournament",
      })),
    });
  }

  /**
   * WHAT TO SUGGEST, FROM THE TWO THINGS THE APP ACTUALLY KNOWS.
   *
   * The SHAPE is the stronger signal and comes first, because the organizer
   * answered it thirty seconds ago: a round robin needs a season to mean
   * anything, so it has no business at the top of a single round's list.
   *
   * The KIND OF OUTFIT orders what is left, and this is the "more PGA-driven,
   * with room for customization" half. A golf club runs competitions the Rules
   * of Golf name — stroke play, match play, four-ball, foursomes, Stableford —
   * because that is what a handicap record, a club championship and an
   * honours board are built on. A society or a group of friends is as likely
   * to run a scramble or a skins day, which the Rules do not cover at all and
   * which are none the worse for it.
   *
   * SO IT ORDERS; IT NEVER FILTERS. Every starting point stays offered to
   * every outfit, in "Other starting points" — a club that wants a scramble
   * for its away day is doing something completely ordinary, and an app that
   * hid it would be wrong about golf rather than opinionated about it.
   */
  const suggested = sortByOutfit(suggestedFor(input.shape ?? ""), input.orgKind ?? "");
  const suggestedKeys = new Set(suggested.map((t) => t.key));
  if (suggested.length > 0) {
    const shapeLabel = SHAPE_LABEL.get(input.shape ?? "");
    groups.push({
      label: shapeLabel ? `Suits ${lowerFirst(shapeLabel)}` : "Suggested",
      options: suggested.map(optionFor),
    });
  }

  /**
   * Everything else, each exactly once.
   *
   * Named for what it is rather than "All templates": a knockout organizer who
   * wants to start from a medal and add a bracket is doing nothing unusual, so
   * this is the rest of the list and not a fallback.
   */
  const rest = sortByOutfit(
    TOURNAMENT_TEMPLATES.filter((t) => !t.blank && !suggestedKeys.has(t.key)),
    input.orgKind ?? "",
  );
  if (rest.length > 0) {
    groups.push({
      label: suggested.length > 0 ? "Other starting points" : "Start from a template",
      options: rest.map(optionFor),
    });
  }

  // The blank one, under everything and heading nothing.
  const blank = TOURNAMENT_TEMPLATES.filter((t) => t.blank);
  if (blank.length > 0) groups.push({ label: "", options: blank.map(optionFor) });

  return groups;
}

/** "stableford" -> "Stableford", so a scoring basis can be matched against the
 *  Rules' own names without keeping a second spelling of each. */
function titleCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * The forms of play the Rules of Golf actually name.
 *
 * Stroke play and match play are Rules 3.2 and 3.3, four-ball is Rule 23,
 * foursomes is Rule 22, Stableford is Rule 21.1. A scramble, a skins game and
 * greensomes are not in the Rules — which is not a criticism of them, it is
 * the whole distinction: they are social formats, played because they keep a
 * mixed field in the game, and a club championship cannot be one.
 *
 * DERIVED FROM THE FORMAT, deliberately, rather than a flag on each template.
 * A flag is a second opinion about the same golf, and this codebase's
 * most-repeated defect is one rule with two readers — the derived template
 * grouping already exposed a real data error a curated list had hidden. So a
 * template added later is classified the day it is added, by the golf it
 * plays, and nobody has to remember.
 */
const RULES_FORMS: ReadonlySet<string> = new Set([
  "Stroke Play",
  "Match Play",
  "Four-Ball",
  "Foursomes",
  "Stableford",
]);

/**
 * Whether this starting point is a form of play the Rules name.
 *
 * Reads the SCORING BASIS as well as the format, because Stableford is a form
 * of play under Rule 21.1 and this app models it as a stroke-play round with
 * `scoringBasis: "stableford"` — `Stableford` is deliberately not playable as
 * a format. Judging the format alone would already have got that one right for
 * the wrong reason, and would get the next one wrong.
 */
export function isRulesForm(t: TournamentTemplate): boolean {
  const round = t.rounds[0];
  if (!round) return false;
  return RULES_FORMS.has(round.format) || RULES_FORMS.has(titleCase(round.scoringBasis ?? ""));
}

/**
 * STABLEFORD IS THE EXCEPTION, and it is worth stating rather than fudging.
 *
 * It is a form of play the Rules name (21.1), so `isRulesForm` is right about
 * it — and it is also the format a golf society plays more than any other,
 * because a player who blows up a hole picks up, scores nothing for it, and is
 * still in the competition on the next tee. That is exactly what a mixed field
 * on a day out needs, and exactly what stroke play does not give them.
 *
 * So one named exception, with the reason attached, rather than inventing a
 * second axis to make the derivation come out right. The alternative was a
 * hand-written list of "what a society plays", which is the curated list this
 * file avoids everywhere else — and the honest shape of the knowledge really
 * is "the rule, plus this one".
 *
 * Read as: the forms a CLUB should see first. A society sees the others first.
 */
function leadsForOutfit(t: TournamentTemplate, orgKind: string): boolean {
  const societyStaple = t.rounds[0]?.scoringBasis === "stableford";
  return orgKind === "club" ? isRulesForm(t) && !societyStaple : !isRulesForm(t) || societyStaple;
}

/**
 * The same list, ordered for the outfit looking at it. Never filtered.
 *
 * A club sees the Rules forms first and a society sees the social ones first;
 * both see all of them. `personal` follows the society, because a one-off
 * outing with friends is a social occasion by definition — the kind's own
 * blurb says "one organizer running an outing".
 *
 * STABLE, so the order inside each half is still `TOURNAMENT_TEMPLATES` order
 * and two templates that are alike do not swap places between renders.
 */
function sortByOutfit(list: TournamentTemplate[], orgKind: string): TournamentTemplate[] {
  if (!orgKind) return list;
  return list
    .map((t, i) => ({ t, i, leads: leadsForOutfit(t, orgKind) }))
    .sort((a, b) => (a.leads === b.leads ? a.i - b.i : a.leads ? -1 : 1))
    .map((x) => x.t);
}
