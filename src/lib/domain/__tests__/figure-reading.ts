/**
 * READING A FIGURE'S WORKING THE WAY A GOLFER WOULD (2026-10-24).
 *
 * The tests of "every figure explains itself" do not trust the structured
 * answer `figure-working.ts` hands back beside its sentence. They take the
 * NUMBERS OUT OF THE WORDS — what a player reads on the tee — and do the
 * arithmetic the sentence claims, by the Rule. A sentence that says "Gross 86 −
 * playing handicap 14 = net 73" is caught here whatever the code's own figures
 * were.
 *
 * Not a test file: imported by `figure-working.test.ts` and the screen sweep.
 */

/** "+2" is a plus handicap (−2 in arithmetic); "14" is 14. */
export function handicapOf(text: string): number {
  return text.startsWith("+") ? -Number(text.slice(1)) : Number(text);
}

/** A decimal written in the club's way ("14,73" or "14.73"), plus-aware. */
export function decimalOf(text: string): number {
  const plain = text.replace(",", ".");
  return plain.startsWith("+") ? -Number(plain.slice(1)) : Number(plain);
}

const WORD: Record<string, number> = { one: 1, two: 2, three: 3 };
const countOf = (w: string) => WORD[w] ?? Number(w);

export interface StrokeReading {
  /** The strokes the lead says: +1 received, −1 given back, 0 none. */
  lead: number;
  playing: number;
  strokeIndex: number;
  nine: boolean;
  /** What the spread clause gives THIS stroke index, worked from its own words. */
  fromSpread: number;
}

/** "You get a stroke here: your playing handicap is 14 and this hole is stroke index 7, and its 14 strokes go one a hole on stroke index 1 to 14." */
export function readStrokeSentence(says: string): StrokeReading {
  const lead = /^You get (a stroke|(\d+) strokes) here/.exec(says)
    ? (() => {
        const m = /^You get (a stroke|(\d+) strokes) here/.exec(says)!;
        return m[2] ? Number(m[2]) : 1;
      })()
    : /^You give (a stroke|(\d+) strokes) back here/.exec(says)
      ? (() => {
          const m = /^You give (a stroke|(\d+) strokes) back here/.exec(says)!;
          return -(m[2] ? Number(m[2]) : 1);
        })()
      : /^No stroke here/.test(says)
        ? 0
        : NaN;
  const ph = /your playing handicap is (\+?\d+)/.exec(says);
  const si = /this hole is stroke index (\d+)( of nine)?/.exec(says);
  if (!ph || !si) throw new Error(`unreadable stroke sentence: ${says}`);
  const playing = handicapOf(ph[1]);
  const strokeIndex = Number(si[1]);
  const nine = !!si[2];
  const n = nine ? 9 : 18;

  // The spread clause, read on its own and applied to this hole.
  let fromSpread = NaN;
  if (/receives no strokes/.test(says)) fromSpread = 0;
  const every = /are (one|two|three|\d+) on every hole|, (one|two|three|\d+) on every hole/.exec(says);
  const laps = every ? countOf(every[1] ?? every[2]) : 0;
  const range = /(?:go one a hole on|goes on|one more on|back from the easiest hole, on|and one more on) stroke index (\d+)(?: to (\d+))?/.exec(says);
  if (playing > 0) {
    let shots = laps;
    if (range) {
      const lo = Number(range[1]);
      const hi = range[2] ? Number(range[2]) : lo;
      if (strokeIndex >= lo && strokeIndex <= hi) shots += 1;
    }
    fromSpread = shots;
  } else if (playing < 0) {
    let back = laps;
    if (range) {
      const lo = Number(range[1]);
      const hi = range[2] ? Number(range[2]) : lo;
      if (strokeIndex >= lo && strokeIndex <= hi) back += 1;
    }
    fromSpread = back === 0 ? 0 : -back;
  } else {
    fromSpread = 0;
  }
  void n;
  return { lead, playing, strokeIndex, nine, fromSpread };
}

export interface NetReading {
  gross: number;
  /** What was taken off the gross: positive for strokes received. */
  taken: number;
  net: number;
  /** "playing handicap 14" — the whole handicap was taken. */
  whole: boolean;
  holesPlayed: number | null;
}

/** "Gross 86 − playing handicap 14 = net 72." / "Gross 41 − the 7 strokes you receive on the 9 holes played = net 34." */
export function readNetSentence(says: string): NetReading {
  let m = /^Gross (\d+) − playing handicap (\d+) = net (-?\d+)\./.exec(says);
  if (m) return { gross: +m[1], taken: +m[2], net: +m[3], whole: true, holesPlayed: null };
  m = /^Gross (\d+) \+ (\d+) for a playing handicap of \+(\d+) = net (\d+)\./.exec(says);
  if (m) return { gross: +m[1], taken: -m[2], net: +m[4], whole: true, holesPlayed: null };
  m = /^Gross (\d+) − the (\d+) strokes? you receive on the (\d+) holes? played = net (-?\d+)\./.exec(says);
  if (m) return { gross: +m[1], taken: +m[2], net: +m[4], whole: false, holesPlayed: +m[3] };
  m = /^Gross (\d+) \+ the (\d+) strokes? you give back on the (\d+) holes? played = net (\d+)\./.exec(says);
  if (m) return { gross: +m[1], taken: -m[2], net: +m[4], whole: false, holesPlayed: +m[3] };
  throw new Error(`unreadable net sentence: ${says}`);
}

export interface HandicapReading {
  playing: number;
  pct: number;
  base: number;
  /** The share written out, before rounding, or null at 100%. */
  share: number | null;
  rounded: number;
  parStrokes: number;
}

/**
 * "Your playing handicap of 15 is 95% of your course handicap of 14.73: 13.99,
 * rounded once to 14, and 1 more for playing tees of a higher par …"
 */
export function readHandicapSentence(says: string): HandicapReading {
  const NUM = String.raw`\+?\d+(?:[.,]\d+)?`;
  const playing = /Your playing handicap of (\+?\d+) is /.exec(says);
  const base = new RegExp(`(?:your course handicap of|the committee's figure of) (${NUM})`).exec(says);
  if (!playing || !base) throw new Error(`unreadable handicap sentence: ${says}`);
  const pct = /is (\d+)% of /.exec(says);
  const share = new RegExp(`: (${NUM}), rounded once to (\\+?\\d+)`).exec(says);
  const roundedOnly = /, rounded once to (\+?\d+)/.exec(says);
  const pars = /and (\d+) more for playing tees of a higher par/.exec(says);
  const baseValue = decimalOf(base[1]);
  return {
    playing: handicapOf(playing[1]),
    pct: pct ? Number(pct[1]) : 100,
    base: baseValue,
    share: share ? decimalOf(share[1]) : null,
    rounded: share ? handicapOf(share[2]) : roundedOnly ? handicapOf(roundedOnly[1]) : Math.round(baseValue),
    parStrokes: pars ? Number(pars[1]) : 0,
  };
}

/** "5 less a stroke received is net 4 on a par 4: 2 points …" */
export function readPointsSentence(says: string): { net: number; par: number; points: number; gross: number | null; shots: number } {
  const m =
    /^(?:Net (-?\d+) on a par (\d+)|(\d+) less (a stroke|(\d+) strokes) received is net (-?\d+) on a par (\d+)|(\d+) and (a stroke|(\d+) strokes) given back is net (\d+) on a par (\d+)): (-?\d+) points?/.exec(
      says,
    );
  if (!m) throw new Error(`unreadable points sentence: ${says}`);
  if (m[1] != null) return { net: +m[1], par: +m[2], points: +m[13], gross: null, shots: 0 };
  if (m[3] != null) return { net: +m[6], par: +m[7], points: +m[13], gross: +m[3], shots: m[5] ? +m[5] : 1 };
  return { net: +m[11], par: +m[12], points: +m[13], gross: +m[8], shots: -(m[10] ? +m[10] : 1) };
}

export interface TieReading {
  name: string;
  score: string;
  kind: "ahead" | "behind" | "shared" | "for-now" | "no-countback";
  holes?: number;
  mine?: number;
  theirs?: number;
  place?: number;
}

/** Every tie the sentence speaks of. */
export function readTieSentences(says: string): TieReading[] {
  const out: TieReading[] = [];
  const decided = /Level with (.+?) on (\S+); (ahead|behind) on the countback over the last (?:(\d+) holes|hole)(?: of [^:]+)?: (\d+)(?: points?)? to (\d+)/g;
  for (const m of says.matchAll(decided)) {
    out.push({ name: m[1], score: m[2], kind: m[3] as "ahead" | "behind", holes: m[4] ? +m[4] : 1, mine: +m[5], theirs: +m[6] });
  }
  const shared = /Shares (\d+)(?:st|nd|rd|th) with (.+?)( for now)?: level on (\S+?),? (and level on|and a countback|and a round this short)/g;
  for (const m of says.matchAll(shared)) {
    out.push({
      name: m[2],
      score: m[4],
      kind: m[3] ? "for-now" : m[5] === "and a round this short" ? "no-countback" : "shared",
      place: +m[1],
    });
  }
  return out;
}

/** "−2: 84 gross, less 14 strokes received, is net 70, against a par of 72 for the 18 holes played." */
export function readBoardNet(says: string): { shown: string; gross: number; taken: number; net: number; par: number; holes: number } {
  const m = /^(E|[+-]\d+): (\d+) gross, (?:less (\d+) strokes? received|and (\d+) strokes? given back), is net (\d+), against a par of (\d+) for the (\d+) holes? played/.exec(says);
  if (!m) throw new Error(`unreadable board sentence: ${says}`);
  return { shown: m[1], gross: +m[2], taken: m[3] != null ? +m[3] : -m[4], net: +m[5], par: +m[6], holes: +m[7] };
}

/** "E" is level; "+3" and "-2" are what they say. */
export function toParOf(text: string): number {
  return text === "E" ? 0 : Number(text);
}
