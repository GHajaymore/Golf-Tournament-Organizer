"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMatch } from "@/app/actions/match-setup";
import { CoursePicker, type CourseOption } from "@/components/CoursePicker";
import { matchTitle } from "@/lib/domain/quick-match";
import { Icon } from "./Icon";

/**
 * Setting up a match, in one screen.
 *
 * The order of the questions is the design. Who is playing comes first
 * because it is the only thing the two of them definitely know; everything
 * below it has a working answer already filled in, so the form is finishable
 * from the first field. Nothing here is required except the second name.
 *
 * What is NOT asked is as deliberate as what is. No email, no mobile, no
 * handicap source, no tournament shape, no template, no flights: those are
 * questions a club running a championship has answers to, and a question with
 * no answer is where somebody stops.
 */
export function NewMatchForm({
  courses,
  myName,
}: {
  /** The club's own courses. Empty for somebody who has never set one up,
   *  which is the common case here and why the picker is conditional. */
  courses: CourseOption[];
  /** Prefilled as the first player: whoever is setting this up is almost
   *  always in it, and correcting a name is quicker than typing one. */
  myName: string;
}) {
  const router = useRouter();
  const [a, setA] = useState(myName);
  const [b, setB] = useState("");
  const [holes, setHoles] = useState(18);
  const [nine, setNine] = useState("front");
  const [useHandicaps, setUseHandicaps] = useState(false);
  const [hcpA, setHcpA] = useState("");
  const [hcpB, setHcpB] = useState("");
  const [courseId, setCourseId] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const ready = a.trim().length > 0 && b.trim().length > 0;

  const submit = () => {
    if (!ready) return;
    startTransition(async () => {
      setError("");
      const res = await createMatch({
        players: [
          { name: a, handicap: useHandicaps ? hcpA : 0 },
          { name: b, handicap: useHandicaps ? hcpB : 0 },
        ],
        holes,
        nine: holes === 9 ? nine : "full",
        useHandicaps,
        courseId,
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn't set that match up.");
        return;
      }
      // Straight to the card. The whole promise of this screen is that setting
      // up a match and starting it are one act, so landing on a dashboard —
      // with a checklist, about a tournament — would undo it at the last step.
      router.push("/entry");
    });
  };

  const pill = (active: boolean) => ({
    padding: "9px 14px",
    minHeight: 44,
    borderRadius: 10,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--color-text)",
    background: active ? "color-mix(in srgb, var(--color-accent) 16%, transparent)" : "var(--color-bg)",
    border: `1px solid ${active ? "var(--color-accent)" : "var(--color-divider)"}`,
  });

  return (
    <div className="card elev-sm" style={{ gap: 16 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>Who&rsquo;s playing?</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          Just the two names. Nobody needs an account to be played against.
        </p>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div className="field">
          <label>Player 1</label>
          <input className="input" value={a} onChange={(e) => setA(e.target.value)} placeholder="You" />
        </div>
        <div className="field">
          <label>Player 2</label>
          <input
            className="input"
            value={b}
            onChange={(e) => setB(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Your opponent"
            autoFocus
          />
        </div>
      </div>

      <div className="field">
        <label>How many holes?</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <button type="button" style={pill(holes === 18)} onClick={() => setHoles(18)}>18 holes</button>
          <button type="button" style={pill(holes === 9)} onClick={() => setHoles(9)}>9 holes</button>
        </div>
        {holes === 9 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" style={pill(nine === "front")} onClick={() => setNine("front")}>Front nine</button>
            <button type="button" style={pill(nine === "back")} onClick={() => setNine("back")}>Back nine</button>
          </div>
        )}
      </div>

      {/* Level by default, and the wording says which is which rather than
          "gross" and "net" — two friends deciding whether shots are being
          given do not reach for the scoring vocabulary to do it. */}
      <div className="field">
        <label>Are shots being given?</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <button type="button" style={pill(!useHandicaps)} onClick={() => setUseHandicaps(false)}>
            No — play level
          </button>
          <button type="button" style={pill(useHandicaps)} onClick={() => setUseHandicaps(true)}>
            Yes — off handicaps
          </button>
        </div>
        {useHandicaps && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 10 }}>
            <div className="field">
              <label>{a.trim() || "Player 1"}&rsquo;s handicap</label>
              <input
                className="input"
                inputMode="decimal"
                value={hcpA}
                onChange={(e) => setHcpA(e.target.value)}
                placeholder="e.g. 12.4"
              />
            </div>
            <div className="field">
              <label>{b.trim() || "Player 2"}&rsquo;s handicap</label>
              <input
                className="input"
                inputMode="decimal"
                value={hcpB}
                onChange={(e) => setHcpB(e.target.value)}
                placeholder="e.g. 18.1"
              />
            </div>
          </div>
        )}
        {useHandicaps && (
          <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0", lineHeight: 1.5 }}>
            Strokes are given by stroke index, so a course with its card filled in is needed before
            this can be scored. Playing level needs nothing.
          </p>
        )}
      </div>

      {/* Only where there is something to pick. A brand-new account has no
          course library, and an empty picker offering one choice called
          "Decide later" is a question pretending to be a control.

          Directory search is OFF here, and this is the one screen where that
          is not a shortcut: importing a course reads the ACTIVE tournament to
          find the club it belongs to, and on this screen the tournament does
          not exist yet. The round's own venue picker has the full search the
          moment the match is created. */}
      {courses.length > 0 && (
        <CoursePicker
          options={courses}
          value={courseId}
          onChange={setCourseId}
          label="Where are you playing?"
          noneLabel="Decide later"
          searchDirectory={false}
        />
      )}

      {error && (
        <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={pending || !ready} onClick={submit}>
          {pending ? "Setting it up…" : "Start the match"} <Icon name="arrow-right" />
        </button>
        <span className="text-muted" style={{ fontSize: 11.5 }}>
          {ready ? `Opens the card for ${matchTitle(a.trim(), b.trim())}.` : "Both names, and you're away."}
        </span>
      </div>
    </div>
  );
}
