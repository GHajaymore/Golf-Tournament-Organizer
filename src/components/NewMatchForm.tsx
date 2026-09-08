"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMatch } from "@/app/actions/match-setup";
import { CoursePicker, type CourseOption } from "@/components/CoursePicker";
import {
  planMatch,
  exactPlayersFor,
  QUICK_ROUND_FORMATS,
  QUICK_ROUND_MAX_PLAYERS,
} from "@/lib/domain/quick-match";
import { Icon } from "./Icon";

/**
 * Setting up one casual round, in one screen.
 *
 * The order of the questions is the design, and it changed when the screen
 * stopped making only matches. WHAT you are playing now comes before WHO is
 * playing, which reverses the original reasoning ("who is playing comes first
 * because it is the only thing the two of them definitely know"). That was
 * right while there was one format; it is wrong now, because the format
 * decides how many names the screen will take. Asking it second means typing
 * four names and then being told the game you picked is played by two.
 *
 * What is NOT asked is as deliberate as what is. No email, no mobile, no
 * handicap source, no tournament shape, no template, no flights, no tee sheet,
 * and no second round: those are questions a club running a championship has
 * answers to, and a question with no answer is where somebody stops.
 *
 * THE RULES ARE NOT RESTATED HERE. The screen calls `planMatch` — the same
 * pure function the server action calls — on every keystroke and shows what it
 * refuses. So the button is disabled exactly when the action would refuse, and
 * for the same stated reason, without this file holding a second opinion about
 * how many people play match play.
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
  const [format, setFormat] = useState(QUICK_ROUND_FORMATS[0].name);
  const [players, setPlayers] = useState<{ name: string; hcp: string }[]>([
    { name: myName, hcp: "" },
    { name: "", hcp: "" },
  ]);
  const [holes, setHoles] = useState(18);
  const [nine, setNine] = useState("front");
  const [useHandicaps, setUseHandicaps] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const chosen = QUICK_ROUND_FORMATS.find((f) => f.name === format) ?? QUICK_ROUND_FORMATS[0];
  const exact = exactPlayersFor(chosen);
  const ceiling = exact ?? QUICK_ROUND_MAX_PLAYERS;
  const named = players.filter((p) => p.name.trim().length > 0);

  const setPlayer = (i: number, patch: Partial<{ name: string; hcp: string }>) =>
    setPlayers((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  /**
   * Picking a round type opens the rows it needs, and never closes any.
   *
   * Four-Ball needs four names and the screen starts with two, so without this
   * the first thing choosing it does is produce an error about a number the
   * player has been given no way to reach. Growing is safe; SHRINKING is what
   * this deliberately does not do — switching from Four-Ball back to Match
   * Play would delete two names somebody had typed, and the error asking them
   * to remove two is recoverable in a way that silently binning them is not.
   */
  const chooseFormat = (name: string) => {
    setFormat(name);
    const want = exactPlayersFor(QUICK_ROUND_FORMATS.find((f) => f.name === name) ?? chosen);
    if (want !== null) {
      setPlayers((prev) =>
        prev.length >= want
          ? prev
          : [...prev, ...Array.from({ length: want - prev.length }, () => ({ name: "", hcp: "" }))],
      );
    }
  };

  /**
   * The same answer the server will give, computed as they type.
   *
   * Not a preview of it — literally it. The alternative is a second copy of
   * "match play is two players" in this file, and the one thing this codebase
   * keeps rediscovering is that two copies of a rule is how one of them ends
   * up wrong.
   */
  const planned = planMatch({
    players: players.map((p) => ({ name: p.name, handicap: useHandicaps ? p.hcp : 0 })),
    format,
    holes,
    nine: holes === 9 ? nine : "full",
    useHandicaps,
    courseId,
  });

  /**
   * Held back until there are two names to judge.
   *
   * "A round needs at least two players" is true of an empty form and useless
   * on one — it is the state every round starts in, and showing it there turns
   * the first keystroke into an error message.
   */
  const blocker = !planned.ok && named.length >= 2 ? planned.error : "";

  const submit = () => {
    if (!planned.ok) return;
    startTransition(async () => {
      setError("");
      const res = await createMatch({
        players: players.map((p) => ({ name: p.name, handicap: useHandicaps ? p.hcp : 0 })),
        format,
        holes,
        nine: holes === 9 ? nine : "full",
        useHandicaps,
        courseId,
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn't set that round up.");
        return;
      }
      // Straight to the card. The whole promise of this screen is that setting
      // a round up and starting it are one act, so landing on a dashboard —
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
        <span className="card-title" style={{ fontSize: 15 }}>What are you playing?</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          One round, scored properly. For a series of rounds, a field to flight or a tee sheet,
          set up a tournament instead.
        </p>
      </div>

      {/* Grouped by SIDE SIZE, which is the same question as "on your own or
          in pairs" and is answered by choosing a round type rather than asked
          separately. Every entry is playable end to end — an engine, score
          entry and a board — and the same engines the tournament path uses. */}
      {[
        { size: 1, heading: "On your own" },
        { size: 2, heading: "In pairs" },
      ].map((group) => (
        <div key={group.size} style={{ display: "grid", gap: 8 }}>
          <span className="card-kicker">{group.heading}</span>
          {QUICK_ROUND_FORMATS.filter((f) => f.sideSize === group.size).map((f) => {
            const active = f.name === format;
            const needs = exactPlayersFor(f);
            return (
              <button
                key={f.name}
                type="button"
                onClick={() => chooseFormat(f.name)}
                aria-pressed={active}
                style={{
                  ...pill(active),
                  textAlign: "left",
                  padding: "11px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {active && <Icon name="check" />}
                  {f.name}
                  <span className="text-muted" style={{ fontWeight: 500, fontSize: 11.5 }}>
                    · {needs ? `${needs} players` : `${2}–${QUICK_ROUND_MAX_PLAYERS} players`}
                  </span>
                </span>
                <span className="text-muted" style={{ fontWeight: 400, fontSize: 11.5, lineHeight: 1.45 }}>
                  {f.blurb}
                </span>
              </button>
            );
          })}
        </div>
      ))}

      <div>
        <span className="card-title" style={{ fontSize: 15 }}>Who&rsquo;s playing?</span>
        {/* The second sentence is a DISCLOSURE, not a nicety. Every player is
            written to the club roster by `upsertMember`, and a player entered
            without an email is matched there BY NAME — so a second, different
            Dave entered later lands on the first Dave's row and overwrites his
            index. Measured; see docs/session-2026-09-08.md.

            Somebody told their playing partner becomes a club member types the
            email, which is exactly what makes the round precise. The
            registration screen has said this all along ("Anyone added here
            joins the club roster too"); the screen that tells you no account is
            needed was the one that did not. */}
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          Just names. Nobody needs an account to be played against — though everyone
          joins your club roster, so an email keeps two players of the same name apart.
        </p>
        {/* Said BEFORE the names are typed, not discovered afterwards.

            The sides are taken in entry order — the first two against the next
            two — and that is a rule the player has to know while they are
            typing, because it is the only thing that decides who they are
            partnering. A screen that pairs people silently and shows the
            result at the end has asked them to guess. */}
        {chosen.sideSize > 1 && (
          <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
            <Icon name="users" /> Partners are taken in the order below — the first{" "}
            {chosen.sideSize} against the next {chosen.sideSize}.
          </p>
        )}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {players.map((p, i) => (
          <div key={i} style={{ display: "grid", gap: 4 }}>
            {/* The side heading, on the row that opens one. This is the
                pairing rule made concrete: it appears above player 1 and
                player 3, so "the first two against the next two" is something
                the screen SHOWS rather than something it claims. */}
            {chosen.sideSize > 1 && i % chosen.sideSize === 0 && (
              <span className="card-kicker" style={{ marginTop: i === 0 ? 0 : 6 }}>
                Side {Math.floor(i / chosen.sideSize) + 1}
              </span>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label>Player {i + 1}</label>
              <input
                className="input"
                value={p.name}
                onChange={(e) => setPlayer(i, { name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={i === 0 ? "You" : "Playing partner"}
                autoFocus={i === 1}
              />
            </div>
            {useHandicaps && (
              <div className="field" style={{ width: 104 }}>
                <label>Handicap</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={p.hcp}
                  onChange={(e) => setPlayer(i, { hcp: e.target.value })}
                  placeholder="12.4"
                />
              </div>
            )}
            {/* Never below two. A round with one person in it is a practice
                round, and this screen is for a competitive one. */}
            {players.length > 2 && (
              <button
                type="button"
                className="btn btn-ghost"
                aria-label={`Remove player ${i + 1}`}
                style={{ minHeight: 44, minWidth: 44, padding: "0 12px" }}
                onClick={() => setPlayers((prev) => prev.filter((_, j) => j !== i))}
              >
                <Icon name="x" />
              </button>
            )}
            </div>
          </div>
        ))}

        {players.length < ceiling ? (
          <div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ minHeight: 44 }}
              onClick={() => setPlayers((prev) => [...prev, { name: "", hcp: "" }])}
            >
              <Icon name="plus" /> Add a player
            </button>
          </div>
        ) : (
          <p className="text-muted" style={{ fontSize: 11.5, margin: 0 }}>
            {exact
              ? `${chosen.name} is played between two sides of ${chosen.sideSize} — that is ${exact}. Pick another round type for a bigger group.`
              : `${QUICK_ROUND_MAX_PLAYERS} is the most for a casual round — beyond two fourballs, set up a tournament.`}
          </p>
        )}
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
          "gross" and "net" — friends deciding whether shots are being given do
          not reach for the scoring vocabulary to do it. */}
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
          moment it is created. */}
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

      {(error || blocker) && (
        <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error || blocker}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={pending || !planned.ok} onClick={submit}>
          {pending
            ? "Setting it up…"
            : planned.ok && !planned.plan.drawsMatch
              ? "Start the round"
              : "Start the match"}{" "}
          <Icon name="arrow-right" />
        </button>
        <span className="text-muted" style={{ fontSize: 11.5 }}>
          {planned.ok ? `Opens the card for ${planned.plan.name}.` : "Two names, and you're away."}
        </span>
      </div>
    </div>
  );
}
