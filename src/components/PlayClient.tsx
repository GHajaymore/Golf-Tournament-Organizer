"use client";
import { useState, useTransition } from "react";
import { redeemRoundCode, claimPlayerSlot, leavePlay, savePlayMatchHoles, savePlayMatchResult } from "@/app/actions/play";
import { OrgBrand, type Brand } from "./OrgBrand";
import type { HoleResult } from "@/lib/domain";

interface PlayMatch {
  id: string;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  aHandicap: number;
  bHandicap: number;
  holes: HoleResult[];
  /** True when the session holder is stored as player B — results must be
   *  flipped back before saving. */
  flipped: boolean;
}

interface Props {
  stage: "code" | "score" | "no-match";
  brand?: Brand | null;
  playerName?: string;
  eventName?: string;
  roundLabel?: string;
  submitWhole?: boolean;
  match?: PlayMatch;
  /**
   * How many holes THIS ROUND is played over.
   *
   * The grid used to be sized from `pars.length`, which is the card and not
   * the round. A nine-hole match handed the event's eighteen-hole card drew
   * eighteen cells, and since only nine of them can ever be filled the submit
   * button read "Fill all 18 holes to submit" and stayed disabled for good —
   * a player with a round code could not hand in their card at all. The nine
   * cells past the end were then discarded on save, so the number on screen
   * was never the number being stored either.
   */
  holes?: number;
  pars?: number[];
  yards?: number[];
  strokeIndex?: number[];
  netMode?: boolean;
}

function Shell({ brand, children }: { brand?: Brand | null; children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        padding: "22px 16px 40px",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <OrgBrand brand={brand} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function PlayClient(props: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [players, setPlayers] = useState<Array<{ id: string; name: string }> | null>(null);
  const [context, setContext] = useState<{ eventName: string; roundLabel: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Local copy of the hole results, from the session holder's point of view.
  const [holes, setHoles] = useState<HoleResult[]>(props.match?.holes ?? []);
  const [saved, setSaved] = useState(false);
  // Two ways a finished match arrives: tapped hole by hole as it was played,
  // or phoned in from the green as "3&2". Both write the same record.
  const [entryMode, setEntryMode] = useState<"holes" | "result">("holes");
  const [resultWinner, setResultWinner] = useState<"me" | "them" | "halved">("me");
  const [resultMargin, setResultMargin] = useState("");

  /* ── Step 1: enter the code ───────────────────────────────────────── */

  if (props.stage === "code") {
    const submit = () => {
      setError("");
      startTransition(async () => {
        const res = await redeemRoundCode(code);
        if (!res.ok) {
          setError(res.error ?? "That code isn't valid.");
          return;
        }
        setPlayers(res.players ?? []);
        setContext({ eventName: res.eventName ?? "", roundLabel: res.roundLabel ?? "" });
      });
    };

    if (players && context) {
      return (
        <Shell brand={props.brand}>
          <div style={{ marginBottom: 16 }}>
            <div className="page-kicker">{context.roundLabel}</div>
            <h1 style={{ fontSize: 24, margin: "5px 0 0", fontFamily: "var(--font-heading)" }}>
              {context.eventName}
            </h1>
            <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
              Tap your name to start entering your score.
            </p>
          </div>

          {error && (
            <p style={{ fontSize: 13, color: "var(--color-danger)" }}>
              <i className="ph ph-warning-circle" /> {error}
            </p>
          )}

          <div className="card elev-sm" style={{ padding: 0, overflow: "hidden" }}>
            {players.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await claimPlayerSlot(code, p.id);
                    if (!res.ok) setError(res.error ?? "Couldn't start your session.");
                    else window.location.reload();
                  })
                }
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "13px 14px",
                  fontSize: 15,
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--color-divider)",
                  color: "var(--color-text)",
                  cursor: "pointer",
                }}
              >
                {p.name}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn"
            style={{ marginTop: 12 }}
            onClick={() => {
              setPlayers(null);
              setContext(null);
            }}
          >
            Use a different code
          </button>
        </Shell>
      );
    }

    return (
      <Shell brand={props.brand}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, margin: 0, fontFamily: "var(--font-heading)" }}>Enter your score</h1>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Type the round code your organizer gave you — it&rsquo;s on the tee sheet, or they&rsquo;ll have
            read it out on the first tee.
          </p>
        </div>

        <div className="card elev-sm" style={{ gap: 12 }}>
          <div className="field">
            <label>Round code</label>
            <input
              className="input"
              value={code}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="ABCD-EFGH"
              style={{ fontSize: 20, letterSpacing: "0.12em", textAlign: "center" }}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>

          {error && (
            <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
              <i className="ph ph-warning-circle" /> {error}
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={pending || code.trim().length === 0}
            onClick={submit}
          >
            {pending ? "Checking…" : "Continue"}
          </button>
        </div>
      </Shell>
    );
  }

  /* ── Signed in with a code, but not playing this round ────────────── */

  if (props.stage === "no-match") {
    return (
      <Shell brand={props.brand}>
        <div className="card elev-sm">
          <span className="card-title">No match for you in {props.roundLabel}</span>
          <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
            {props.playerName}, you don&rsquo;t have a match scheduled in this round of {props.eventName}.
            Check with your organizer.
          </p>
          <button
            type="button"
            className="btn"
            style={{ alignSelf: "flex-start", marginTop: 12 }}
            onClick={() => startTransition(async () => { await leavePlay(); window.location.reload(); })}
          >
            Sign out
          </button>
        </div>
      </Shell>
    );
  }

  /* ── Step 2: the card ─────────────────────────────────────────────── */

  const m = props.match!;
  // The round's own answer first. The card's length is a fallback for a caller
  // that has not been taught to send one, and 18 the last resort — but neither
  // of those is what decides how many holes a round is.
  const holeCount = props.holes || props.pars?.length || holes.length || 18;
  const filled = holes.filter((h) => h !== null).length;
  const complete = filled === holeCount;

  const setHole = (i: number, value: HoleResult) => {
    setHoles((prev) => {
      const next = [...prev];
      while (next.length < holeCount) next.push(null);
      next[i] = next[i] === value ? null : value;
      return next;
    });
    setSaved(false);
  };

  const save = () => {
    setError("");
    startTransition(async () => {
      // Stored results are always A-relative; flip back if this player is B.
      const outgoing = m.flipped
        ? holes.map((h) => (h === "A" ? "B" : h === "B" ? "A" : h))
        : holes;
      const res = await savePlayMatchHoles(m.id, outgoing as Array<"A" | "B" | "H" | null>);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      setSaved(true);
    });
  };

  const saveResult = () => {
    setError("");
    startTransition(async () => {
      // A-relative like everything stored: "me" flips when this player is B.
      const w =
        resultWinner === "halved" ? "H" : (resultWinner === "me") !== !!m.flipped ? "A" : "B";
      const res = await savePlayMatchResult(m.id, w, resultMargin);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      setSaved(true);
    });
  };

  const won = holes.filter((h) => h === "A").length;
  const lost = holes.filter((h) => h === "B").length;
  const halved = holes.filter((h) => h === "H").length;

  return (
    <Shell brand={props.brand}>
      <div style={{ marginBottom: 14 }}>
        <div className="page-kicker">{props.roundLabel} · {props.eventName}</div>
        <h1 style={{ fontSize: 22, margin: "5px 0 0", fontFamily: "var(--font-heading)" }}>
          {m.aName} <span className="text-muted" style={{ fontSize: 15 }}>vs</span> {m.bName}
        </h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
          Tap who won each hole. {props.submitWhole
            ? "Your organizer wants the full round submitted at the end."
            : "Saves as you go."}
        </p>
      </div>

      <div className="seg" style={{ marginBottom: 10 }}>
        <label className="seg-opt">
          <input type="radio" name="playmode" checked={entryMode === "holes"} onChange={() => setEntryMode("holes")} />
          Hole by hole
        </label>
        <label className="seg-opt">
          <input type="radio" name="playmode" checked={entryMode === "result"} onChange={() => setEntryMode("result")} />
          Final result
        </label>
      </div>

      {entryMode === "result" && (
        <div className="card elev-sm" style={{ gap: 12 }}>
          <p className="text-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
            The finished match, straight from the green. This replaces anything tapped hole by hole.
          </p>
          <div className="seg" style={{ width: "100%" }}>
            {(["me", "halved", "them"] as const).map((w) => (
              <label key={w} className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input type="radio" name="playwinner" checked={resultWinner === w} onChange={() => setResultWinner(w)} />
                {w === "me" ? "I won" : w === "halved" ? "Halved" : "They won"}
              </label>
            ))}
          </div>
          {resultWinner !== "halved" && (
            <div className="field">
              <label>By how much</label>
              <input
                className="input"
                value={resultMargin}
                onChange={(e) => setResultMargin(e.target.value)}
                placeholder={'e.g. "3&2", "2 UP", "1 UP"'}
                inputMode="text"
              />
            </div>
          )}
          <button type="button" className="btn btn-primary" disabled={pending} onClick={saveResult}>
            {pending ? "Saving…" : saved ? "Saved" : "Submit result"}
          </button>
          {error && (
            <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
              <i className="ph ph-warning-circle" /> {error}
            </p>
          )}
        </div>
      )}

      {entryMode === "holes" && (
      <div className="card elev-sm" style={{ gap: 10 }}>
        <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
          <span><b>{won}</b> won</span>
          <span><b>{halved}</b> halved</span>
          <span><b>{lost}</b> lost</span>
          <span className="text-muted" style={{ marginLeft: "auto" }}>{filled}/{holeCount} holes</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {Array.from({ length: holeCount }, (_, i) => {
            const v = holes[i] ?? null;
            return (
              <div
                key={i}
                style={{
                  border: "1px solid var(--color-divider)",
                  borderRadius: "var(--radius-md)",
                  padding: "6px 6px 7px",
                }}
              >
                <div className="text-muted" style={{ fontSize: 10, marginBottom: 4, textAlign: "center" }}>
                  {i + 1}
                  {props.pars?.[i] ? ` · par ${props.pars[i]}` : ""}
                </div>
                <div style={{ display: "flex", gap: 3 }}>
                  {(["A", "H", "B"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      disabled={pending}
                      onClick={() => setHole(i, opt)}
                      style={{
                        flex: 1,
                        padding: "6px 0",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 5,
                        cursor: "pointer",
                        border: "1px solid var(--color-divider)",
                        background:
                          v === opt ? "var(--color-accent)" : "transparent",
                        color: v === opt ? "var(--color-accent-100, #fff)" : "var(--color-text)",
                      }}
                    >
                      {opt === "A" ? "Me" : opt === "H" ? "½" : "Opp"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
            <i className="ph ph-warning-circle" /> {error}
          </p>
        )}

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={pending || (props.submitWhole && !complete)}
          onClick={save}
        >
          {pending
            ? "Saving…"
            : saved
              ? "Saved — your organizer will review it"
              : props.submitWhole
                ? complete
                  ? "Submit my card"
                  : `Fill all ${holeCount} holes to submit`
                : "Save"}
        </button>
      </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <span className="text-muted" style={{ fontSize: 12 }}>Playing as {props.playerName}</span>
        <button
          type="button"
          className="btn"
          style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px" }}
          onClick={() => startTransition(async () => { await leavePlay(); window.location.reload(); })}
        >
          Sign out
        </button>
      </div>
    </Shell>
  );
}
