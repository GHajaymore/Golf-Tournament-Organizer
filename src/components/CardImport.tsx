"use client";
import { useMemo, useState, useTransition } from "react";
import { importClubCourseCard } from "@/app/actions/courses";
import { parseCard, type CardProblem } from "@/lib/domain/scorecard-parse";
import { CourseCardCamera } from "@/components/CourseCardCamera";

/**
 * Add a course by pasting its card.
 *
 * A club's own website almost always renders the card as a table, and pasting
 * three rows takes about twenty seconds — against fifty-four typed numbers, or
 * a third-party data source that doesn't exist yet.
 *
 * Everything is checked before it saves, and the check is shown while you
 * type. That ordering is the point: an organizer pastes, sees "stroke index 8
 * missing, 6 used twice — holes 10 and 15", and fixes it against the card in
 * their hand. The alternative is discovering it during a protest, because a
 * wrong stroke index never looks wrong — it just gives shots to the wrong
 * holes.
 *
 * The same review runs whatever produced the numbers. When a camera extractor
 * exists it fills these boxes and the organizer confirms exactly as they do
 * here.
 */
export function CardImport({
  defaultCity = "",
  cardScanAvailable = true,
  onDone,
}: {
  /** The club's city, so a local course doesn't need retyping. */
  defaultCity?: string;
  /** False when this club's plan doesn't include card reading. Passed in
   *  rather than discovered, so the locked state renders before a photo is
   *  taken and uploaded. */
  cardScanAvailable?: boolean;
  onDone?: () => void;
}) {
  const [name, setName] = useState("");
  const [city, setCity] = useState(defaultCity);
  const [sourceUrl, setSourceUrl] = useState("");
  const [holes, setHoles] = useState<9 | 18>(18);
  const [pars, setPars] = useState("");
  const [yards, setYards] = useState("");
  const [strokeIndex, setStrokeIndex] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // Validated as you type, not on submit. The whole value of this screen is
  // catching a shifted row while the card is still in front of you.
  const card = useMemo(
    () => (pars.trim() || strokeIndex.trim() ? parseCard({ pars, yards, strokeIndex }, holes) : null),
    [pars, yards, strokeIndex, holes],
  );

  const problemsFor = (row: CardProblem["row"]) => card?.problems.filter((p) => p.row === row) ?? [];

  const Row = ({
    label,
    hint,
    value,
    onChange,
    row,
    optional,
  }: {
    label: string;
    hint: string;
    value: string;
    onChange: (v: string) => void;
    row: CardProblem["row"];
    optional?: boolean;
  }) => {
    const problems = problemsFor(row);
    return (
      <div className="field">
        <label>
          {label}
          {optional && <span className="text-muted"> — optional</span>}
        </label>
        <textarea
          className="input"
          rows={2}
          value={value}
          disabled={pending}
          onChange={(e) => onChange(e.target.value)}
          placeholder={hint}
          style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, minHeight: 48 }}
        />
        {problems.map((p, i) => (
          <p key={i} style={{ fontSize: 11.5, margin: "4px 0 0", color: "var(--color-danger)", lineHeight: 1.45 }}>
            <i className="ph ph-warning-circle" /> {p.message}
            {p.holes.length > 0 && (
              <> Check hole{p.holes.length > 1 ? "s" : ""} {p.holes.join(", ")}.</>
            )}
          </p>
        ))}
      </div>
    );
  };

  const submit = () => {
    setError("");
    startTransition(async () => {
      const res = await importClubCourseCard({ name, city, pars, yards, strokeIndex, holes, sourceUrl });
      if (!res.ok) {
        setError(res.error ?? "Couldn't add that course.");
        return;
      }
      setSaved(true);
      setName("");
      setPars("");
      setYards("");
      setStrokeIndex("");
      setSourceUrl("");
      onDone?.();
    });
  };

  const ready = !!name.trim() && !!card?.ok;

  return (
    <div className="card elev-sm" style={{ gap: 14 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>Paste a course card</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0", maxWidth: "68ch", lineHeight: 1.5 }}>
          Copy the par, yardage and stroke-index rows straight off the club&apos;s website — totals and
          labels are stripped automatically. Everything is checked before it saves.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div className="field">
          <label>Course name</label>
          <input className="input" value={name} disabled={pending} onChange={(e) => setName(e.target.value)} placeholder="Bushwood" />
        </div>
        <div className="field">
          <label>City</label>
          <input className="input" value={city} disabled={pending} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="field">
          <label>Holes</label>
          <div className="seg" style={{ width: "100%" }}>
            <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name="cardholes" checked={holes === 18} onChange={() => setHoles(18)} />18
            </label>
            <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name="cardholes" checked={holes === 9} onChange={() => setHoles(9)} />9
            </label>
          </div>
        </div>
      </div>

      <CourseCardCamera
        available={cardScanAvailable}
        holes={holes}
        disabled={pending}
        onReading={({ pars: p, strokeIndex: si, yards: y }) => {
          // Replaces rather than merges, unlike score entry. A card is read
          // as one card: keeping half of a previous reading beside half of
          // this one would produce a routing that exists on no course, and
          // it would reconcile.
          setPars(p);
          setStrokeIndex(si);
          // Only when this photo produced one, so a readable yardage row is
          // not wiped by a second photo taken to fix the pars.
          if (y) setYards(y);
        }}
      />

      <Row
        label="Par"
        row="pars"
        value={pars}
        onChange={setPars}
        hint="4 5 3 4 4 4 3 4 5 36 4 4 3 4 5 4 3 4 4 35 71"
      />
      <Row
        label="Stroke index"
        row="strokeIndex"
        value={strokeIndex}
        onChange={setStrokeIndex}
        hint="7 3 11 1 15 5 17 9 13 8 4 12 2 16 6 18 10 14"
      />
      <Row
        label="Yardage"
        row="yards"
        value={yards}
        onChange={setYards}
        optional
        hint="412 528 168 445 …"
      />

      <div className="field">
        <label>Where it came from <span className="text-muted">— optional</span></label>
        <input
          className="input"
          value={sourceUrl}
          disabled={pending}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://theclub.example/scorecard"
        />
      </div>

      {/* Totals to check against the card in hand — the one thing a validator
          cannot verify, because any set of pars sums to something. */}
      {card && card.ok && (
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            padding: "10px 12px",
            borderRadius: "var(--radius-md)",
            fontSize: 12.5,
            background: "color-mix(in srgb, var(--color-accent-2) 12%, transparent)",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent-2) 30%, transparent)",
          }}
        >
          <i className="ph ph-check-circle" style={{ fontSize: 15, color: "var(--color-accent-2-400)" }} />
          <span>
            Reads as <strong>par {card.totals.par}</strong>
            {holes === 18 && <> — out {card.totals.outPar}, in {card.totals.inPar}</>}
            {card.totals.yards > 0 && <>, {card.totals.yards} yards</>}. Does that match the card?
          </span>
        </div>
      )}

      {error && (
        <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
      {saved && (
        <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-accent-2-400)" }}>
          <i className="ph ph-check" /> Added, and marked unverified until someone checks it against the
          real card.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={pending || !ready} onClick={submit}>
          <i className="ph ph-plus" /> {pending ? "Adding…" : "Add course"}
        </button>
        {!ready && (pars.trim() || strokeIndex.trim()) && (
          <span className="text-muted" style={{ fontSize: 12 }}>
            {name.trim() ? "Fix the rows above first." : "Give the course a name."}
          </span>
        )}
      </div>
    </div>
  );
}
