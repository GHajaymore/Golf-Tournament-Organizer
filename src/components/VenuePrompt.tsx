"use client";
import { useOrgProfile } from "@/components/OrgProfileProvider";
import { useMemo, useState, useTransition } from "react";
import { nameMatchVenue } from "@/app/actions/courses";
import { matchCourse, needsNine, cardProblems, teeProblems, exactCardClaim } from "@/lib/domain/venue";
import { parseCard } from "@/lib/domain/scorecard-parse";
import { Icon } from "./Icon";

const BLANK = new Array(18).fill("");

/**
 * How many of the club's courses to offer before asking somebody to narrow it.
 *
 * Six is about a league's rotation, which is the case this screen exists for.
 * A club that has imported a catalogue has hundreds, and a wall of them is a
 * worse answer than a text box — so the rest stay behind the filter, and the
 * count of them is shown rather than hidden.
 */
const SHORTLIST = 6;

export interface VenueCourse {
  id: string;
  name: string;
  city?: string;
  address?: string;
  /**
   * Whether the club's stored row actually HAS a card — pars and a stroke
   * index — or is a name somebody added and never filled in.
   *
   * The distinction is invisible without it, and this screen used to state
   * the opposite: `matchCourse` finding a stored row makes the screen say
   * "Using the club's saved card", which for one of these is a claim about a
   * card that does not exist. A round then scores against no pars and no
   * stroke index — to-par computed against nothing, handicap strokes with
   * nowhere to fall — which is the failure #195 was about, arrived at from
   * the other end.
   *
   * Optional so a caller that genuinely does not know says nothing rather
   * than asserting a card is there.
   */
  hasCard?: boolean;
}

/**
 * "Where did you play?" — asked at scoring time, in a tournament with no
 * fixed course.
 *
 * The order matters. The club's own courses are offered first, because after
 * a few weeks of a league most rounds are at a course somebody has already
 * entered, and picking one is a single tap. Only a genuinely new course asks
 * for a card, and then it asks for all of it: par and stroke index because
 * they decide net scores and where shots fall, and the tees because course
 * handicap is Index × Slope/113 + (CR − Par) and slope belongs to the tee,
 * not the course.
 *
 * Nothing here guesses. A course this club has never played has no card until
 * somebody types one, and a card that fails its own checks is refused rather
 * than stored — a wrong stroke index produces a wrong result that looks
 * entirely normal, which is worse than being asked for a card.
 */
export function VenuePrompt({
  matchId,
  holes,
  library,
  aName,
  bName,
}: {
  matchId: string;
  /** 9 or 18 — decides whether which-nine has to be asked. */
  holes: number;
  library: VenueCourse[];
  aName: string;
  bName: string;
}) {
  // A society is not a club, and this screen is the one a society lives on:
  // a different course every month. See OrgProfileProvider.
  const org = useOrgProfile();
  const [typed, setTyped] = useState("");
  const [chosen, setChosen] = useState<VenueCourse | null>(null);
  const [nine, setNine] = useState<"full" | "front" | "back">(holes === 9 ? "front" : "full");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [pastePar, setPastePar] = useState("");
  const [pasteSi, setPasteSi] = useState("");
  const [pasteYards, setPasteYards] = useState("");
  const [pars, setPars] = useState<string[]>(BLANK);
  const [yards, setYards] = useState<string[]>(BLANK);
  const [si, setSi] = useState<string[]>(BLANK);
  const [teeName, setTeeName] = useState("");
  const [cr, setCr] = useState("");
  const [slope, setSlope] = useState("");
  const [teePar, setTeePar] = useState("72");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  // Live, so someone typing "Maketewah" sees the club already has it before
  // they start filling in a card by hand.
  const found = useMemo(() => (typed.trim() ? matchCourse(typed, library) : null), [typed, library]);
  const isNew = found?.kind === "new";
  /** Whether the screen may claim a saved card. See `exactCardClaim`. */
  const claim = exactCardClaim(found);

  /**
   * The club's own courses, BROWSABLE rather than guessable.
   *
   * The note at the top of this file has always said the club's courses are
   * "offered first" and that picking one is "a single tap". They were not, and
   * it was not: `library` reached exactly one expression — `matchCourse(typed,
   * library)` — which needs something typed before it can match anything. On
   * an empty field `found` is null, so the screen was a bare text box reading
   * "Start typing — e.g. Maketewah" and nothing else. A scorer had to remember
   * and correctly spell a course the club had already stored, or type a card
   * for it by hand a second time.
   *
   * Its sibling had this right all along: the round's venue picker uses
   * `CoursePicker`, which lists the library in a select. Two screens asking
   * the same question, one of which could answer it.
   *
   * Filtered by what has been typed so the field still narrows, and capped so
   * a club with a large catalogue gets a shortlist rather than a wall — the
   * count of the rest is shown so nobody assumes the list is everything.
   */
  const shortlist = useMemo(() => {
    const q = typed.trim().toLowerCase();
    const rows = q
      ? library.filter((c) => `${c.name} ${c.city ?? ""}`.toLowerCase().includes(q))
      : library;
    return { rows: rows.slice(0, SHORTLIST), more: Math.max(0, rows.length - SHORTLIST) };
  }, [typed, library]);

  /**
   * Not shown once the question is answered.
   *
   * `exact` already says "using the club's saved card"; `suggest` already
   * lists its own candidates and asks which one is meant. Repeating the
   * library under either would be a second list disagreeing with the first.
   */
  const browsing = !chosen && found?.kind !== "exact" && found?.kind !== "suggest";

  /**
   * A course the club HAS, without a card.
   *
   * The card grid used to be gated on `isNew` alone, so this row could be
   * settled on and never asked for one — and the action would then pin the
   * match to a course with no pars and no stroke index. Asked for here, and
   * stored on the row the club already has rather than a duplicate.
   */
  const settled = chosen ?? (found?.kind === "exact" ? found.course : null);
  const needsCard = settled?.hasCard === false;

  const nums = (xs: string[]) => xs.map((v) => parseInt(v, 10)).map((n) => (Number.isFinite(n) ? n : 0));

  const applyPaste = () => {
    const r = parseCard({ pars: pastePar, strokeIndex: pasteSi, yards: pasteYards || undefined });
    // Fill in whatever was read even when it isn't clean — seeing 16 of 18
    // holes land and two sit wrong is far easier to correct than an error
    // over an empty grid. The card still can't be saved until it passes.
    setPars(r.pars.map(String));
    setSi(r.strokeIndex.map(String));
    if (r.yards.length) setYards(r.yards.map(String));
    setError(r.ok ? "" : (r.problems[0]?.message ?? "That card didn't read cleanly."));
  };

  const submit = () => {
    setError("");
    const tee =
      teeName.trim() || cr || slope
        ? {
            name: teeName,
            courseRating: parseFloat(cr) || 0,
            slopeRating: parseInt(slope, 10) || 0,
            par: parseInt(teePar, 10) || 72,
          }
        : undefined;
    if (tee) {
      const t = teeProblems(tee);
      if (t.length) return setError(t[0]);
    }
    // `needsCard` too: a course the club already has, without one, is settled
    // on without ever being new — and the action refuses it rather than
    // pinning the match to a course that cannot score.
    if (isNew || needsCard || (!chosen && found?.kind !== "exact")) {
      const problems = cardProblems({ pars: nums(pars), strokeIndex: nums(si) }, 18);
      if (problems.length) return setError(problems[0]);
    }
    const courseId = chosen?.id ?? (found?.kind === "exact" ? found.course.id : undefined);
    startTransition(async () => {
      const r = await nameMatchVenue(matchId, {
        courseId,
        // Sent alongside a courseId when that course has no card, which is the
        // one case where both are meaningful: the row exists and only its card
        // is missing, so the action fills it in rather than creating a second
        // course under the same name.
        newCourse:
          courseId && !needsCard
            ? undefined
            : { name: typed, city, address, pars: nums(pars), yards: nums(yards), strokeIndex: nums(si) },
        tee,
        nine,
      });
      if (!r.ok) setError(r.error ?? "Couldn't save that.");
    });
  };

  const grid = (label: string, vals: string[], set: (v: string[]) => void, hint: string) => (
    <div style={{ marginTop: 10 }}>
      <label style={{ fontSize: 12, fontWeight: 600 }}>
        {label} <span className="text-muted" style={{ fontWeight: 400 }}>{hint}</span>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 4, marginTop: 4 }}>
        {vals.map((v, i) => (
          <input
            key={i}
            className="input"
            style={{ padding: "6px 2px", textAlign: "center", fontSize: 13 }}
            value={v}
            inputMode="numeric"
            aria-label={`${label} hole ${i + 1}`}
            onChange={(e) => {
              const next = [...vals];
              next[i] = e.target.value.replace(/\D/g, "");
              set(next);
            }}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="card elev-sm" style={{ gap: 10 }}>
      <div>
        <span className="card-kicker">Where was this played?</span>
        <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.5 }}>
          {aName} v {bName} — this tournament has no fixed course, so the card
          can&rsquo;t be scored until we know the venue.
        </p>
      </div>

      <div className="field">
        <label>Golf course</label>
        <input
          className="input"
          value={typed}
          onChange={(e) => { setTyped(e.target.value); setChosen(null); }}
          placeholder="Start typing — e.g. Maketewah"
          autoFocus
        />
      </div>

      {/* The club's own courses, there to be tapped. See `shortlist`: this is
          the "offered first" the note at the top of this file has always
          claimed and never did. */}
      {browsing && shortlist.rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {typed.trim() ? "Courses matching that" : `Courses this ${org.noun} has played`} — one tap uses
            its saved card.
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {shortlist.rows.map((c) => (
              <button
                key={c.id}
                type="button"
                className="btn btn-secondary touch-target"
                style={{ fontSize: 12.5 }}
                // Sets BOTH: `chosen` is what `submit` reads for the id, and
                // the text field follows so the screen does not go on saying
                // "start typing" under a course that has been picked.
                onClick={() => {
                  setChosen(c);
                  setTyped(c.name);
                }}
              >
                {c.name}
                {c.city ? <span className="text-muted"> · {c.city}</span> : null}
                {/* Said plainly, because "one tap uses its saved card" is not
                    true of a row somebody added and never filled in. */}
                {c.hasCard === false ? (
                  <span className="text-muted"> · needs its card</span>
                ) : null}
              </button>
            ))}
          </div>
          {shortlist.more > 0 && (
            <span className="text-muted" style={{ fontSize: 11.5 }}>
              {shortlist.more} more — type to narrow the list.
            </span>
          )}
        </div>
      )}

      {/* The club already has it: one tap, real card, nothing to type. */}
      {claim === "has-card" && found?.kind === "exact" && (
        <div className="tag tag-accent-2" style={{ alignSelf: "flex-start" }}>
          <Icon name="check-circle" /> Using the {org.noun}&rsquo;s saved card for {found.course.name}
        </div>
      )}

      {/* The row exists; the card does not. Claiming a saved card here is the
          one thing this screen must not do — the round would score against no
          pars and no stroke index, and every total would look ordinary. */}
      {claim === "no-card" && found?.kind === "exact" && (
        <div className="tag tag-neutral" style={{ alignSelf: "flex-start" }}>
          <Icon name="warning-circle" /> {found.course.name} is in the library with no card yet — add
          it on the course, under {" "}
          <a href="/organization">its settings</a>, so every later round here has it.
        </div>
      )}

      {found?.kind === "suggest" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="text-muted" style={{ fontSize: 12 }}>
            Did you mean one of these? Picking the right one matters — the stroke
            index decides where handicap strokes fall.
          </span>
          {found.candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              className={chosen?.id === c.id ? "btn btn-primary" : "btn btn-secondary"}
              style={{ alignSelf: "flex-start" }}
              onClick={() => setChosen(c)}
            >
              {c.name}{c.city ? ` — ${c.city}` : ""}
            </button>
          ))}
        </div>
      )}

      {(isNew || needsCard) && (
        <>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            {needsCard
              ? `${settled?.name} is in the ${org.noun}'s library with no card yet — add it once and every later round there has it.`
              : `New to this ${org.noun} — add its card once and every later round here has it.`}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field">
              <label>City</label>
              <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cincinnati, OH" />
            </div>
            <div className="field">
              <label>Address</label>
              <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="5401 Kennedy Ave" />
            </div>
          </div>

          {/* Row at a time, because that is how a card is laid out and how it
              comes off a club website or a photo someone is reading from. */}
          <div className="field">
            <label>Paste the card, a row at a time</label>
            <input className="input" value={pastePar} onChange={(e) => setPastePar(e.target.value)} placeholder="Par   4 5 3 4 4 4 3 4 5  36  …" />
            <input className="input" style={{ marginTop: 6 }} value={pasteSi} onChange={(e) => setPasteSi(e.target.value)} placeholder="S.I.  7 3 11 1 15 5 17 9 13 …" />
            <input className="input" style={{ marginTop: 6 }} value={pasteYards} onChange={(e) => setPasteYards(e.target.value)} placeholder="Yards (optional)" />
            <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={applyPaste}>
              <Icon name="clipboard" /> Read these rows
            </button>
            <span className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Out, In and Total columns are ignored, so a row copied straight
              off a card or a course website works.
            </span>
          </div>

          {grid("Par", pars, setPars, "front nine, then back")}
          {grid("Stroke index", si, setSi, "1–18, each once")}
          {grid("Yards", yards, setYards, "optional")}
        </>
      )}

      {/* Asked whichever way the course arrived — a saved course may not have
          the tees this pair actually played off. */}
      {(isNew || chosen || found?.kind === "exact") && (
        <div style={{ marginTop: 6 }}>
          <span className="card-kicker">Tees played</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 6px", lineHeight: 1.5 }}>
            Course handicap is Index × Slope ÷ 113 + (Rating − Par), so the tees
            decide how many shots change hands. Both are printed on the card.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 8 }}>
            <div className="field">
              <label>Tees</label>
              <input className="input" value={teeName} onChange={(e) => setTeeName(e.target.value)} placeholder="Blue" />
            </div>
            <div className="field">
              <label>Rating</label>
              <input className="input" value={cr} onChange={(e) => setCr(e.target.value)} placeholder="72.4" inputMode="decimal" />
            </div>
            <div className="field">
              <label>Slope</label>
              <input className="input" value={slope} onChange={(e) => setSlope(e.target.value)} placeholder="133" inputMode="numeric" />
            </div>
            <div className="field">
              <label>Par</label>
              <input className="input" value={teePar} onChange={(e) => setTeePar(e.target.value)} inputMode="numeric" />
            </div>
          </div>
        </div>
      )}

      {needsNine(holes, null) && (
        <div className="field">
          <label>Which nine?</label>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            {(["front", "back"] as const).map((n) => (
              <label key={n} className="seg-opt">
                <input type="radio" name="which-nine" checked={nine === n} onChange={() => setNine(n)} />
                {n === "front" ? "Front (1–9)" : "Back (10–18)"}
              </label>
            ))}
          </div>
          <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
            The two halves have different pars and a different stroke index, so
            this decides which holes the shots fall on.
          </p>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 13, color: "var(--color-danger)", fontWeight: 500 }}>
          <Icon name="warning-circle" /> {error}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        style={{ alignSelf: "flex-start" }}
        disabled={pending || !typed.trim()}
        onClick={submit}
      >
        {pending ? "Saving…" : "Use this course"} <Icon name="arrow-right" />
      </button>
    </div>
  );
}
