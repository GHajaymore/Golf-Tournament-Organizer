"use client";
import { useMemo, useState, useTransition } from "react";
import { nameMatchVenue } from "@/app/actions/courses";
import { matchCourse, needsNine, cardProblems, teeProblems } from "@/lib/domain/venue";
import { parseCard } from "@/lib/domain/scorecard-parse";

const BLANK = new Array(18).fill("");

export interface VenueCourse {
  id: string;
  name: string;
  city?: string;
  address?: string;
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
    if (isNew || (!chosen && found?.kind !== "exact")) {
      const problems = cardProblems({ pars: nums(pars), strokeIndex: nums(si) }, 18);
      if (problems.length) return setError(problems[0]);
    }
    const courseId = chosen?.id ?? (found?.kind === "exact" ? found.course.id : undefined);
    startTransition(async () => {
      const r = await nameMatchVenue(matchId, {
        courseId,
        newCourse: courseId
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

      {/* The club already has it: one tap, real card, nothing to type. */}
      {found?.kind === "exact" && (
        <div className="tag tag-accent-2" style={{ alignSelf: "flex-start" }}>
          <i className="ph ph-check-circle" /> Using the club&rsquo;s saved card for {found.course.name}
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

      {isNew && (
        <>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            New to this club — add its card once and every later round here has it.
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
              <i className="ph ph-clipboard" /> Read these rows
            </button>
            <span className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Out, In and Total columns are ignored, so a row copied straight
              off a card or a club website works.
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
          <i className="ph ph-warning-circle" /> {error}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        style={{ alignSelf: "flex-start" }}
        disabled={pending || !typed.trim()}
        onClick={submit}
      >
        {pending ? "Saving…" : "Use this course"} <i className="ph ph-arrow-right" />
      </button>
    </div>
  );
}
