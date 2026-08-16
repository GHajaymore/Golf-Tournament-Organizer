"use client";
import { useState, useTransition } from "react";
import { suggestSetup, applySetupProposal } from "@/app/actions/setup-suggest";
import type { SetupProposal } from "@/lib/domain/setup-proposal";
import FieldInfo from "@/components/FieldInfo";
import { LockedFeature } from "@/components/LockedFeature";

/**
 * Describe a tournament in a sentence and get the rounds proposed.
 *
 * The shape of this screen IS the safety argument. A proposal is shown as a
 * list an organizer reads, with anything the description did not settle asked
 * as a plain question, and a button that says exactly what it will do. Nothing
 * happens until that button is pressed.
 *
 * It deliberately does not look like a chat. A conversation invites trust in
 * the answer; a list of rounds with a Create button invites checking it.
 */
export function DescribeTournament({ available = true }: { available?: boolean }) {
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<SetupProposal | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, startTransition] = useTransition();

  const ask = () =>
    startTransition(async () => {
      setError("");
      setDone("");
      setProposal(null);
      const res = await suggestSetup(text);
      if (!res.ok || !res.proposal) {
        setError(res.error ?? "Couldn't work that out.");
        return;
      }
      setProposal(res.proposal);
    });

  const apply = () =>
    startTransition(async () => {
      if (!proposal) return;
      setError("");
      const res = await applySetupProposal(proposal.rounds);
      if (!res.ok) {
        setError(res.error ?? "Couldn't create those rounds.");
        return;
      }
      setDone(
        `Added ${proposal.rounds.length} round${proposal.rounds.length === 1 ? "" : "s"}. Everything is editable below.`,
      );
      setProposal(null);
      setText("");
    });

  // Shown locked rather than hidden. The whole value of this screen is that an
  // organizer discovers they could describe a tournament in a sentence — a
  // feature they never see is a feature they never want.
  if (!available) {
    return (
      <div className="card elev-sm" style={{ gap: 10, marginBottom: 16 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Describe it instead</span>
        <LockedFeature feature="aiAssist" insteadOf="Build the rounds with the controls below." />
      </div>
    );
  }

  return (
    <div className="card elev-sm" style={{ gap: 10, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Describe it instead</span>
        <FieldInfo label="describing a tournament">
          <p>
            Say what you are running the way you would tell someone at the club, and the rounds are
            worked out for you to check.
          </p>
          <p>
            <b>Nothing is created until you press Create.</b> Anything the description doesn&rsquo;t
            settle is asked rather than guessed, and every round stays editable afterwards.
          </p>
        </FieldInfo>
      </div>

      <textarea
        className="input"
        rows={2}
        placeholder="Two-round member-guest, 24 pairs, four-ball off 90%, cut the top 8 after round one"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ resize: "vertical", fontFamily: "var(--font-body)" }}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary" disabled={pending || text.trim().length < 8} onClick={ask}>
          {pending ? "Working it out…" : "Work out the rounds"}
        </button>
        <span className="text-muted" style={{ fontSize: 11.5 }}>
          Proposes rounds for you to check — creates nothing on its own.
        </span>
      </div>

      {proposal && (
        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
          {proposal.rounds.length > 0 && (
            <>
              <span className="card-kicker">Proposed</span>
              <ol style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 12.5, lineHeight: 1.7 }}>
                {proposal.rounds.map((r, i) => (
                  <li key={i}>
                    <b>{r.format}</b> · {r.holes} holes · {r.scoringBasis}
                    <span className="text-muted"> · {r.type}</span>
                  </li>
                ))}
              </ol>
            </>
          )}

          {/* Read as advice, not settings: the allowance and field size are
              shown because they help an organizer check the reading, but this
              button only ever creates rounds. Claiming otherwise would be the
              kind of quiet over-reach that makes a tool untrustworthy. */}
          {(proposal.allowancePct !== null || proposal.fieldSize !== null || proposal.cut) && (
            <p className="text-muted" style={{ fontSize: 12, margin: "10px 0 0", lineHeight: 1.6 }}>
              Also heard:
              {proposal.fieldSize !== null ? ` about ${proposal.fieldSize} players;` : ""}
              {proposal.allowancePct !== null ? ` ${proposal.allowancePct}% handicap allowance;` : ""}
              {proposal.cut
                ? ` a cut of ${proposal.cut.mode === "percent" ? `${proposal.cut.value}%` : `top ${proposal.cut.value}`} after round ${proposal.cut.afterRound};`
                : ""}{" "}
              set those on the round cards — this button only adds the rounds.
            </p>
          )}

          {proposal.questions.length > 0 && (
            <div
              style={{
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Worth deciding yourself</span>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
                {proposal.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          {proposal.rounds.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" disabled={pending} onClick={apply}>
                Create {proposal.rounds.length} round{proposal.rounds.length === 1 ? "" : "s"}
              </button>
              <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setProposal(null)}>
                Discard
              </button>
            </div>
          )}
        </div>
      )}

      {done && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-accent-2)" }}>
          <i className="ph ph-check-circle" /> {done}
        </p>
      )}
      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
