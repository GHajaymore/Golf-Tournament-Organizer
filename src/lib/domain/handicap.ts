/**
 * World Handicap System conversions.
 *
 * The distinction this file exists to enforce: a **Handicap Index** is a
 * portable measure of a golfer's ability, and a **Course Handicap** is how
 * many strokes that ability is worth *on one set of tees at one course*. They
 * are different numbers, and using the first where the second belongs is the
 * single most common way an otherwise correct scoring engine produces wrong
 * results.
 *
 *     Course Handicap = Index × (Slope ÷ 113) + (Course Rating − Par)
 *
 * The slope term scales for difficulty relative to a bogey golfer: 113 is the
 * standard, so a 140-slope course gives a 12.4 index 15 strokes rather than
 * 12. The rating term accounts for a course that plays harder or easier than
 * its par for a scratch golfer.
 *
 * Without both, players off different tees are scored as though the course
 * plays identically for everyone — which is exactly the problem slope and
 * rating were introduced to solve, and why a member-guest with mixed tees
 * cannot be settled fairly on raw indexes.
 */

/** The neutral slope. A course of this difficulty leaves an index unchanged. */
export const STANDARD_SLOPE = 113;

/** Bounds published for slope ratings; anything outside is a data-entry error. */
export const MIN_SLOPE = 55;
export const MAX_SLOPE = 155;

export interface TeeRating {
  /** Course Rating for these tees, in strokes (e.g. 71.5). */
  courseRating: number;
  /** Slope Rating, 55–155. */
  slopeRating: number;
  /** Par for the holes being played. */
  par: number;
}

/**
 * Course Handicap from a Handicap Index and a set of tees.
 *
 * Rounded to the nearest whole stroke, which is how the allocation onward
 * expects it — strokes are given per hole and there is no half stroke.
 *
 * Returns the index unchanged when the tees carry no rating data. That is a
 * deliberate fallback rather than a refusal: plenty of societies play courses
 * whose rating nobody has to hand, and scoring them on raw indexes is what
 * this app did for its whole life. Better to keep working and let the UI say
 * the number is unrated than to block the round.
 */
export function courseHandicap(index: number, tee: Partial<TeeRating> | null | undefined): number {
  return wholeStrokes(courseHandicapExact(index, tee));
}

/**
 * THE COURSE HANDICAP BEFORE IT IS ROUNDED — the figure an allowance is applied to.
 *
 * Rules of Handicapping, Rule 6.2a and Appendix C: a handicap allowance is
 * "applied to the unrounded Course Handicap as the final step in calculating a
 * player's Playing Handicap", and the result is rounded once, .5 upwards. The
 * whole number a player is told on the first tee is this figure rounded, and it
 * is what `courseHandicap` returns; it is NOT what 95% or 85% is taken of.
 *
 * Until 2026-10-13 the app took the allowance of the rounded figure and rounded
 * again, on purpose, and said so here. Measured over every index from 0.0 to
 * 36.0 on four sets of tees, that gives between a fifth and a quarter of a
 * field one stroke too many or one too few, in every net round with an
 * allowance below 100 — which is every individual net round (95%) and every
 * four-ball. The USGA's own example: indexes 8.6 and 10.3 off 71.0/125, par 71,
 * at 85% play off 8 and 10; rounding twice makes both of them 9.
 *
 * With no rated tees there is no conversion to make and the index is the
 * figure, unrounded for the same reason.
 */
export function courseHandicapExact(index: number, tee: Partial<TeeRating> | null | undefined): number {
  if (!Number.isFinite(index)) return 0;
  if (!tee || !Number.isFinite(tee.slopeRating ?? NaN) || !(tee.slopeRating ?? 0)) {
    return index;
  }
  const slope = clampSlope(tee.slopeRating!);
  const rating = Number.isFinite(tee.courseRating ?? NaN) ? tee.courseRating! : 0;
  const par = Number.isFinite(tee.par ?? NaN) ? tee.par! : 0;
  // The rating adjustment only applies when both numbers are real; a tee with
  // a slope but no rating still gets the slope scaling, which is the larger
  // and more important of the two terms.
  const ratingTerm = rating && par ? rating - par : 0;
  return index * (slope / STANDARD_SLOPE) + ratingTerm;
}

/**
 * A figure in strokes, rounded to the whole number a golfer plays off: nearest,
 * and .5 upwards (so a plus handicap of 2.5 is plus 2), as the Rules say.
 *
 * The sliver added first is for the machine, not for golf. An index has one
 * decimal place and a slope is a whole number over 113, so a figure that is
 * exactly a half in arithmetic (11.3 off a 125 slope is 12.5) can arrive as
 * 12.499999999999998 — and would be rounded DOWN by a rule that says up. It is
 * a billion times smaller than the smallest step any of these figures can take.
 */
export function wholeStrokes(strokes: number): number {
  if (!Number.isFinite(strokes)) return 0;
  const whole = Math.round(strokes + 1e-9);
  // Never "-0": it prints as "-0" in places and is not equal to 0 under Object.is.
  return whole === 0 ? 0 : whole;
}

/** Keep a slope inside the published range so one bad row can't distort a field. */
export function clampSlope(slope: number): number {
  if (!Number.isFinite(slope)) return STANDARD_SLOPE;
  return Math.min(MAX_SLOPE, Math.max(MIN_SLOPE, slope));
}

/**
 * Playing Handicap: the UNROUNDED Course Handicap after the format's allowance,
 * rounded once (Rule 6.2a — see `courseHandicapExact`).
 *
 * Hand it the exact figure: `CourseHandicaps.exact(id)`, or `exact` off
 * `resolveRoundHandicap`. A whole number is right only where a whole number is
 * all there is — a committee's own figure for the round, which the Rule allows
 * for exactly that case, or a round frozen before the exact figure was kept.
 * `allowance-is-taken-of-the-exact-figure.test.ts` reads every caller.
 */
export function playingHandicapFrom(courseHcpExact: number, allowancePct: number): number {
  return wholeStrokes((courseHcpExact * allowancePct) / 100);
}

/**
 * WHAT A PLAYER PLAYS OFF IN A ROUND: the allowance of their course handicap,
 * AND THE STROKES FOR PLAYING TEES OF A HIGHER PAR (Rule 6.2b).
 *
 * Rules of Handicapping, 6.2b: where players compete from sets of tees with
 * DIFFERENT PARS, in stroke play or match play scored on gross or net strokes,
 * "a player competing from a set of tees with a higher par must receive
 * additional strokes for the round, equal to the difference between the par of
 * the tees they are playing and the tees with the lowest par":
 *
 *     Playing Handicap = (Course Handicap x allowance) + difference in pars
 *
 * The allowance is NOT taken of those strokes, which is why they are a
 * separate argument and not folded into the course handicap.
 *
 * It follows from the Course Handicap carrying "Course Rating − Par" (see
 * `courseHandicapExact`): that term measures each player against the par of
 * their OWN tees, so two players who each play to their handicap finish level
 * with par — 71 off one set, 72 off the other — and a medal ranked on net
 * STROKES puts the second a stroke behind for playing to exactly the same
 * standard. Where the result is counted against par (Stableford, par/bogey)
 * that is already level and nothing is added, and the Rule says so.
 *
 * The app had none of it until 2026-10-13. The seeded club's own medal is
 * "Men's & Ladies'", off tees of par 71 and par 72: every lady in it was a
 * stroke short, and a test that worked the board out "by the Rules" agreed with
 * the board, because it had read 6.2a and not 6.2b. Found by asking a golf
 * professional what the tests left out.
 *
 * `playingHandicapFrom` above is the arithmetic of an allowance and nothing
 * else. THIS is what a round is priced with, and its third argument is
 * REQUIRED, not defaulted to nought, so that every place a round's playing
 * handicap is worked out says which it is: the round's own figure
 * (`CourseHandicaps.parStrokes`, where `parStrokesApply` says the format is
 * one the Rule covers) or `NO_PAR_STROKES`.
 * `tees-of-a-higher-par-get-their-strokes.test.ts` refuses a file that prices a
 * round with the bare arithmetic.
 */
export function roundPlayingHandicap(courseHcpExact: number, allowancePct: number, parStrokes: number): number {
  return playingHandicapFrom(courseHcpExact, allowancePct) + parStrokes;
}
export const NO_PAR_STROKES = 0;

/**
 * A nine-hole round.
 *
 * Nine-hole ratings are roughly half of eighteen, and a nine-hole index is
 * half an eighteen-hole one. Where a club has published proper nine-hole
 * ratings those should be used directly; this halves an eighteen-hole set as
 * the documented approximation when they haven't.
 */
export function nineHoleTee(tee: TeeRating): TeeRating {
  return {
    courseRating: tee.courseRating / 2,
    slopeRating: tee.slopeRating,
    par: tee.par / 2,
  };
}

/** True when a tee carries enough data to compute a real Course Handicap. */
export function isRated(tee: Partial<TeeRating> | null | undefined): boolean {
  return !!tee && Number.isFinite(tee.slopeRating ?? NaN) && (tee.slopeRating ?? 0) > 0;
}

export interface HandicapExplanation {
  index: number;
  courseHandicap: number;
  playingHandicap: number;
  rated: boolean;
  /** One line an organizer can read out when a player queries their strokes. */
  detail: string;
}

/**
 * The whole calculation, with its reasoning.
 *
 * Golfers query their stroke allocation, and "the computer said so" is not an
 * answer a committee can give. This returns the arithmetic in words so the
 * scorecard and the tee sheet can show exactly where a number came from.
 */
export function explainHandicap(
  index: number,
  tee: Partial<TeeRating> | null | undefined,
  allowancePct: number,
): HandicapExplanation {
  const exact = courseHandicapExact(index, tee);
  const ch = wholeStrokes(exact);
  const ph = playingHandicapFrom(exact, allowancePct);
  const rated = isRated(tee);
  // The figure before rounding, to two places: it is what the allowance is taken
  // of, and without it "15 course handicap, at 90% = 13" reads as a mistake.
  const shown = exact.toFixed(2);

  const detail = rated
    ? `Index ${index} × (${clampSlope(tee!.slopeRating!)} ÷ ${STANDARD_SLOPE})` +
      (tee!.courseRating && tee!.par ? ` + (${tee!.courseRating} − ${tee!.par})` : "") +
      (allowancePct === 100
        ? ` = ${ch} course handicap`
        : ` = ${shown}, a course handicap of ${ch}; ${allowancePct}% of ${shown} = ${ph} playing handicap`)
    : `No course rating for these tees, so the index of ${index} is used as-is` +
      (allowancePct === 100 ? "" : `, at ${allowancePct}% = ${ph}`);

  return { index, courseHandicap: ch, playingHandicap: ph, rated, detail };
}

export interface IndexHolder {
  id: string;
  /** The roster's Handicap Index. */
  handicap: number;
  /** "9" when the stored number is a nine-hole index. */
  handicapType?: string;
  /** Which tees this player is on, if they've been assigned a specific set. */
  teeId?: string | null;
  /**
   * The tees this player’s flight plays from, if it claims any.
   *
   * REQUIRED, and that is the whole point. It was optional, and not one of the
   * eight call sites ever supplied it — the flight's tee lives on `Group.teeId`
   * and nobody joined it — so `teeIdFor("flight", …, undefined, defaultTeeId)`
   * returned the default set every time. A club championship running
   * Championship off the blues, Seniors off the whites and Ladies off the reds
   * had every printed card and tee sheet name the right set, because those read
   * the group directly, while the leaderboard, the round-handicap screen, team
   * side handicaps, net skins, net match play AND the value frozen permanently
   * into `RoundHandicap.frozen` all scored the entire field off the round's
   * default tees.
   *
   * `null` is a real answer — this player's flight claims no tees — and the
   * compiler now makes every caller say which it means. Making it required is
   * what found all eight; the same trick that found the two `send` call sites.
   */
  flightTeeId: string | null;
  /**
   * As the roster records it. Read for one thing: a woman with no set of her
   * own and none from her flight plays the course's ladies' set (`teeIdFor`).
   * Optional here so that a field built by hand in a test need not say; the
   * service that loads a real field (`roundCourseHandicaps`) requires it.
   */
  gender?: string | null;
}

/**
 * The index expressed for the holes actually being played (WHS Rule 6.1b).
 *
 * A Handicap Index describes eighteen holes. Playing nine, it is halved
 * *before* the slope conversion — the nine-hole rating handles the course
 * side, this handles the player side, and each covers exactly one of them:
 *
 *   - 18-hole index, 18-hole round: unchanged.
 *   - 18-hole index,  9-hole round: halved. This was the missing case — the
 *     rating was halved and the index was not, so every player with an
 *     ordinary index received double their strokes in a nine-hole net round.
 *   -  9-hole index,  9-hole round: unchanged (already a nine-hole number).
 *   -  9-hole index, 18-hole round: doubled.
 *
 * Unrounded on purpose: courseHandicap() rounds once at the end, and rounding
 * the half-index first would lose the .5 that decides a stroke.
 */
/**
 * How many holes a round is actually played over: 9 or 18, never anything else.
 *
 * The app stores a round's length as a plain integer, and a dozen and a half
 * call sites each write `holes === 9 ? 9 : 18` to normalise it. That is fine
 * until one of them forgets — and one did. Every path that priced a *team*
 * round passed a hard 18, so a nine-hole four-ball was scored with eighteen
 * -hole handicaps: `courseHandicapMap` uses this number both to convert the
 * index and to pick a nine-hole tee rating, so the sides were given roughly
 * twice the strokes they were owed, on a card that only had nine holes.
 *
 * Naming it makes the intent testable and gives the mistake somewhere to be
 * caught once rather than eighteen times.
 *
 * IT WAS NAMED AND THEN NOT ADOPTED, which is the part worth recording. The
 * paragraph above was written when this was extracted, and afterwards five
 * files used it while **forty-two call sites went on writing the ternary by
 * hand** — across every layer: server actions, services, domain helpers and a
 * dozen screens. A helper you must remember to reach for is the same shape as
 * a guard you must remember to call, and CLAUDE.md says what happens to those.
 *
 * All forty-two were converted on 2026-09-12 and
 * `holes-normalised-once.test.ts` now sweeps `src` for the literal, so the
 * forty-third cannot be written without going red. That test is the reason
 * this comment can stop worrying about it.
 */
export function holesPlayed(holes: number | null | undefined): 9 | 18 {
  return holes === 9 ? 9 : 18;
}

export function indexForHoles(handicap: number, handicapType: string | undefined, holes: number): number {
  if (!Number.isFinite(handicap)) return 0;
  const isNineIndex = handicapType === "9";
  if (holes === 9) return isNineIndex ? handicap : handicap / 2;
  return isNineIndex ? handicap * 2 : handicap;
}

/**
 * Course Handicaps for a whole field, in one place.
 *
 * Built as a map rather than converted at each call site on purpose. There are
 * half a dozen places that consume a handicap — stroke cards, net match play,
 * team allowances, standings — and converting at each one means a single
 * missed site silently reinstates the original bug with no visible symptom.
 * Resolving once, where the field is loaded, makes that impossible.
 *
 * `defaultTee` is the round's tees, used for anyone not assigned their own.
 * Null everywhere means unrated, and every index passes through unchanged —
 * which is exactly how the app behaved before ratings existed.
 */
/**
 * Which tee a player is actually scored off, in ONE place.
 *
 * Two modules resolved this independently with the same expression, which is
 * the drift that makes two screens disagree about a net score. Now a single
 * reader, so a tee policy cannot be honoured on one screen and ignored on the
 * next.
 *
 * `one` means the round's set for the whole field, whatever a player's record
 * says. That is a condition of competition — an ordinary club medal off the
 * whites — and Rule 6.1b makes departing from it a penalty, so the app must
 * not quietly prefer a stored preference over the committee's decision.
 *
 * `own` is the previous behaviour and the default: the player's tee wins,
 * falling back to the round's.
 */
export function teeIdFor(
  policy: string,
  playerTeeId: string | null | undefined,
  /**
   * The tees this player's FLIGHT plays from, if it claims any.
   *
   * A club championship is one tournament off three sets — championship,
   * seniors, ladies — and expressing that per player is 120 decisions nobody
   * will make correctly. Per flight it is three.
   */
  flightTeeId: string | null | undefined,
  defaultTeeId: string | null,
  /**
   * Whether a set is on the course this round is actually played at.
   *
   * REQUIRED, AND NOT DEFAULTED, for the reason `courseHandicapMap` gives
   * about its own policy argument: a caller that forgot would silently price a
   * card off another course's rating, and the compiler is the only thing that
   * reliably finds every call site.
   *
   * A stored `Player.teeId` names a row on ONE course. That is right for a
   * club medal and wrong the moment a tournament moves — a two-day
   * member-guest, a league with no fixed venue — because the preference then
   * points at a set that is not at the course in front of the player. It is
   * not stale, which would be a small error; it is a slope and a course rating
   * from somewhere else, which is a large one. Measured on a two-venue fixture:
   * 17 strokes where 7 is right, with everybody who had NO stored tee priced
   * correctly beside them.
   *
   * So a rung that is not on this course is stepped past rather than honoured
   * — the same rule `teeForPlay` already applies to the round's own chain —
   * and the player falls through to the round's set, which is what the rest of
   * the field is on.
   */
  onThisCourse: (teeId: string) => boolean,
  /**
   * THE LADIES' SET, FOR A WOMAN — `ladiesTeeFor(gender, ladiesTeeOn(...))`,
   * and null for anybody it does not apply to.
   *
   * The rung between a flight and the tournament (Ajay, 2026-10-13: the
   * organizer decides the tees at three levels, tournament, then flight, then
   * one player; "use the common sense of defaulting the tees based on gender").
   * A DEFAULT, not a level: it is what a woman plays where nobody has said
   * otherwise, and anything the organizer set beats it — her flight's set, or
   * her own. Under one set for everyone it is not consulted at all, which is
   * how a committee puts a mixed field on the same tees.
   *
   * Required, and last only so that it could be added without re-ordering
   * every existing call. A caller that left it out would put the ladies on the
   * men's rating on one screen while the board beside it had them on their
   * own, so the compiler is made to find every one.
   */
  ladiesTeeId: string | null,
): string {
  /** A rung is only a rung if it points at a set that is actually here. */
  const here = (id: string | null | undefined) => (id && onThisCourse(id) ? id : null);
  // The policy is the FLOOR of what may override, and specificity wins above
  // it. One set for everyone means neither a flight nor a player may differ;
  // by division means the flight may and a player may not.
  //
  // `defaultTeeId` is NOT filtered: it is the round's own set, resolved by
  // `teeForPlay` against this very course, so asking again would be asking the
  // answer whether it is the answer — and on a tournament whose courses have
  // no tees at all it would turn a harmless "" into a different harmless "".
  if (policy === "one") return defaultTeeId ?? "";
  if (policy === "flight") return here(flightTeeId) ?? here(ladiesTeeId) ?? defaultTeeId ?? "";
  return here(playerTeeId) ?? here(flightTeeId) ?? here(ladiesTeeId) ?? defaultTeeId ?? "";
}

/**
 * Whether a recorded gender is a woman's. The roster takes what a club's file
 * says — "F", "female", "Ladies" — so this reads the spellings a file has.
 * Anything else, a blank included, is not known to be: nobody is moved to
 * other tees on a guess.
 */
export function isWoman(gender: string | null | undefined): boolean {
  return /^(f|w|female|woman|women|lady|ladies|girl|girls)$/i.test((gender ?? "").trim());
}

/** Whether a set of tees is rated for women: `Tee.gender`, in any of the spellings it has been stored with. */
export function teeIsForWomen(teeGender: string | null | undefined): boolean {
  return isWoman(teeGender);
}

/**
 * THE LADIES' SET ON ONE COURSE, or null where the course has none.
 *
 * Where a course rates several sets for women — a directory card often rates
 * every colour for both — it is the one with the LOWEST course rating, which
 * is the shortest: what a club means by "the ladies' tees". A tie goes to the
 * set further down the card.
 */
export function ladiesTeeOn(
  tees: Iterable<readonly [string, { courseId?: string; gender?: string | null; courseRating: number }]>,
  courseId: string | null | undefined,
): string | null {
  if (!courseId) return null;
  let best: { id: string; rating: number } | null = null;
  for (const [id, t] of tees) {
    if (t.courseId !== courseId || !teeIsForWomen(t.gender)) continue;
    if (!best || t.courseRating <= best.rating) best = { id, rating: t.courseRating };
  }
  return best?.id ?? null;
}

/** The ladies' set for THIS player: the course's, for a woman; null for anybody else. */
export function ladiesTeeFor(gender: string | null | undefined, ladiesTeeId: string | null): string | null {
  return isWoman(gender) ? ladiesTeeId : null;
}

/**
 * A field's Course Handicaps: the whole number each player is told, and the
 * figure it was rounded from.
 *
 * A `Map` of whole numbers, exactly as it always was, so the forty-odd readers
 * that want what a player plays off in a round keep calling `.get(id)` and keep
 * getting it. `.exact(id)` is for the one thing a whole number is wrong for:
 * taking an allowance (Rule 6.2a — see `courseHandicapExact`).
 *
 * A class and not a second map handed round beside the first, because a second
 * map is a thing a caller can forget to pass, and the reader that forgot would
 * fall back to the whole number and be a stroke out for one player in five with
 * nothing on any screen wrong. A copy made with `new Map(…)` is a plain `Map`,
 * has no `.exact`, and so cannot reach an allowance without the compiler
 * saying so.
 */
export class CourseHandicaps extends Map<string, number> {
  private readonly unrounded = new Map<string, number>();

  /** Store a player's unrounded Course Handicap; `.get` then answers with it rounded. */
  setExact(playerId: string, exact: number): this {
    this.unrounded.set(playerId, exact);
    return this.set(playerId, wholeStrokes(exact));
  }

  /**
   * The unrounded figure, or undefined for a player this map has not heard of.
   *
   * If somebody has since `.set` a different whole number over the top, that
   * number is the answer: the two must never describe different handicaps.
   */
  exact(playerId: string): number | undefined {
    const whole = this.get(playerId);
    if (whole === undefined) return undefined;
    const exact = this.unrounded.get(playerId);
    return exact !== undefined && wholeStrokes(exact) === whole ? exact : whole;
  }

  private readonly pars = new Map<string, number>();
  private lowestPar: number | null = null;
  private fieldLowestPar: number | null = null;

  /**
   * The pars of the tees the competition's whole FIELD is playing, so that the
   * lowest of them is the same figure in every map built for the round —
   * whichever part of the field that map happens to hold.
   */
  setFieldPars(pars: readonly number[]): this {
    const real = pars.filter((p) => Number.isFinite(p) && p > 0);
    this.fieldLowestPar = real.length > 0 ? Math.min(...real) : null;
    return this;
  }

  /** The par of the tees this player's handicap was worked out from. */
  setPar(playerId: string, par: number): this {
    if (Number.isFinite(par) && par > 0) {
      this.pars.set(playerId, par);
      this.lowestPar = null;
    }
    return this;
  }

  /**
   * The strokes this player receives for playing tees of a higher par than the
   * lowest in this field (Rule 6.2b — see `playingHandicapFrom`). Nought for a
   * player this map knows no par for, and for a field all off one par.
   *
   * "The tees with the lowest par" are the lowest among the tees the FIELD is
   * playing — `setFieldPars`, which `courseHandicapMap` calls with the
   * competition's field. A set of tees nobody is playing does not lower
   * anybody's handicap.
   *
   * AND NOT THE LOWEST AMONG THE PLAYERS IN THIS MAP, unless nobody said who
   * the field is. Half the readers of a round build their map from part of it —
   * the players in one skins pot, the members of one side, the two players of
   * a match — and a map of the ladies' pot alone, all off a par of 72, would
   * find no difference and give nobody the stroke the board beside it gives
   * every one of them. On a hole-by-hole game that is a different hole won.
   *
   * A whole stroke or nothing. The only way to half a stroke is a nine cut
   * from an eighteen of odd par, and `courseHandicapMap` gives a nine no par
   * at all — see there.
   */
  parStrokes(playerId: string): number {
    const mine = this.pars.get(playerId);
    if (mine === undefined) return 0;
    if (this.lowestPar === null) this.lowestPar = Math.min(...this.pars.values());
    const extra = mine - (this.fieldLowestPar ?? this.lowestPar);
    return Number.isInteger(extra) && extra > 0 ? extra : 0;
  }
}

export function courseHandicapMap(
  players: IndexHolder[],
  /**
   * Carries `courseId` now, because the resolution below has to know which
   * sets are at the course being played — see `onThisCourse` in `teeIdFor`. A
   * map of ratings alone cannot answer that, which is exactly why a stored tee
   * from another venue used to win.
   */
  teesById: Map<string, TeeRating & { courseId?: string; gender?: string | null }>,
  defaultTeeId: string | null,
  holes: number,
  /**
   * Required, not defaulted. A default would silently score a single-tee
   * competition off whatever tees players happen to have on their records,
   * and the compiler is the only thing that reliably finds every caller.
   */
  teePolicy: string,
  /**
   * THE COMPETITION'S WHOLE FIELD, where `players` is only part of it.
   *
   * Rule 6.2b gives strokes for the difference from the LOWEST par being
   * played, and that is a fact about the field, not about whoever this map was
   * built for — see `CourseHandicaps.parStrokes`. Left out, `players` is taken
   * to be the field, which is right for a caller that passed all of it.
   */
  field: readonly IndexHolder[] = players,
): CourseHandicaps {
  /**
   * The course this round is played at, taken from the round's OWN set.
   *
   * `teeForPlay` has already resolved `defaultTeeId` against the round's
   * course, so the tee names the course and nothing else needs passing in.
   * Undefined when the tournament has no tees at all, and then every rung is
   * allowed through — there is nothing to be on the wrong side of, and
   * refusing would convert "unrated" into "unrated by a different route".
   */
  const playingAt = defaultTeeId ? teesById.get(defaultTeeId)?.courseId : undefined;
  const onThisCourse = (id: string) => {
    // Nothing to be on the wrong side of.
    if (!playingAt) return true;
    const row = teesById.get(id);
    // A set this map has never heard of resolves to no rating anyway, so
    // refusing it costs nothing and buys the fall-through to the round's set —
    // a real answer instead of an unrated one.
    if (!row) return false;
    // A caller that supplies ratings without a courseId cannot be judged, and
    // must keep behaving exactly as it did rather than start refusing.
    if (row.courseId === undefined) return true;
    return row.courseId === playingAt;
  };
  // The ladies' set at the course being played, once for the field.
  const ladies = ladiesTeeOn(teesById, playingAt);
  const teeOf = (p: IndexHolder) =>
    teeIdFor(teePolicy, p.teeId, p.flightTeeId, defaultTeeId, onThisCourse, ladiesTeeFor(p.gender, ladies));
  const out = new CourseHandicaps();
  for (const p of players) {
    const raw = teesById.get(teeOf(p)) ?? null;
    // Index and rating are each converted to the holes being played, once.
    // See indexForHoles for the four cases and the doubling bug the old
    // one-case conversion caused.
    const index = indexForHoles(p.handicap, p.handicapType, holes);
    const tee = raw && holes === 9 ? nineHoleTee(raw) : raw;
    out.setExact(p.id, courseHandicapExact(index, tee));
    /**
     * The tees' par, for Rule 6.2b — for an EIGHTEEN only. A tee stores the par
     * of its eighteen and not of each nine: half of 72 is 36 whether the nines
     * are 36 and 36 or 35 and 37, so over nine holes the difference in pars
     * between two sets of tees is not something this row knows. Giving a
     * stroke on a guess is worse than giving none and saying so
     * (`docs/deferred-register.md`).
     */
    if (raw && holes !== 9) out.setPar(p.id, raw.par);
  }
  if (holes !== 9) {
    out.setFieldPars(
      field
        .map((p) => teesById.get(teeOf(p))?.par)
        .filter((par): par is number => typeof par === "number"),
    );
  }
  return out;
}
