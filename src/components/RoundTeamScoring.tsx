"use client";
import { useState, useTransition } from "react";
import { TEAM_ENTRY_MODES, type TeamEntryMode } from "@/lib/domain/team-entry";
import { setStageAllowance, setStageAllowanceWeights, setStageCountBest } from "@/app/actions/teams";
import { setStageScoreInput } from "@/app/actions/tournament";
import FieldInfo from "@/components/FieldInfo";

/**
 * How a team round prices its sides: the handicap allowance, the split where
 * a format uses one, and how many balls count.
 *
 * These lived on the Teams screen, which had its own round selector — so a
 * round's format was set in one place and what that format costs in strokes
 * was set in another, with nothing on either screen saying the other existed.
 * They are settings *of the round*, so they belong on the round.
 *
 * Teams keeps what it is actually about: who is on which side.
 */

export interface RoundScoringInfo {
  /** Display name of the round's format. */
  name: string;
  /** Allowance in force — the committee's, or the format's recommendation. */
  allowance: number;
  recommendedAllowance: number;
  allowanceOverridden: boolean;
  /** True where the recommendation is club convention, not a published rule. */
  allowanceIsConvention: boolean;
  /** Per-player shares, best player first, or null for a format without a split. */
  shares: number[] | null;
  recommendedShares: number[] | null;
  sharesOverridden: boolean;
  /** How many partners' scores count, or null where the side plays one ball. */
  countBest: number | null;
  countBestOverridden: boolean;
  /** Most players a side can hold — the ceiling on "best N of". */
  maxSide: number;
  /**
   * Whose card this round is written on, and whether there is a choice at all.
   *
   * One entry means there is none: a shared ball has one line on the paper
   * card and nothing else exists. The screen states that rather than offering
   * it, because a dropdown with one option is a question with one answer.
   */
  entryChoices: TeamEntryMode[];
  entryMode: TeamEntryMode;
  /** What taking the side's card alone gives up, where it is a choice. */
  sideOnlyCost: string | null;
}

export function RoundTeamScoring({ stageId, info }: { stageId: string; info: RoundScoringInfo }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [editingAllowance, setEditingAllowance] = useState(false);
  const [allowance, setAllowance] = useState("");
  const [editingShares, setEditingShares] = useState(false);
  const [shares, setShares] = useState<string[]>([]);
  const [editingCount, setEditingCount] = useState(false);
  const [countBest, setCountBest] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) setError(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Whose card this round is written on.
          One choice means there is no choice: a shared ball has one line on
          the paper card, so the screen states the fact instead of offering a
          dropdown with one option. That is the difference from the incumbent,
          whose help centre carries an article on how to switch an alternate
          shot event to team entry — their organizers are offered a wrong
          option and go looking for support. */}
      {info.entryChoices.length === 1 ? (
        <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
          One ball, one card — the side&rsquo;s strokes are entered on a single line, the way{" "}
          {info.name} is written down on paper.
        </p>
      ) : (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap" }}>
            <span className="text-muted">Scores are entered as</span>
            <select
              className="input"
              style={{ width: "auto", fontSize: 12, padding: "3px 8px" }}
              disabled={pending}
              value={info.entryMode}
              onChange={(e) =>
                // `setStageScoreInput` returns nothing — it either writes the
                // value or discards one the format does not offer, and the
                // refresh brings back whichever it settled on.
                run(async () => {
                  await setStageScoreInput(stageId, e.target.value);
                  return { ok: true };
                })
              }
            >
              {info.entryChoices.map((key: TeamEntryMode) => (
                <option key={key} value={key}>
                  {TEAM_ENTRY_MODES.find((m) => m.key === key)?.label ?? key}
                </option>
              ))}
            </select>
          </label>
          {/* Beside the control, because that is where the choice is made —
              not in a footnote and not in a title. */}
          {info.entryMode === "side-only" && info.sideOnlyCost && (
            <p style={{ fontSize: 11.5, margin: 0, lineHeight: 1.6, color: "var(--color-accent)" }}>
              <i className="ph ph-warning-circle" /> {info.sideOnlyCost}
            </p>
          )}
        </>
      )}

      {/* Reads as a plain statement of what the format recommends until
          someone chooses to change it — almost every round wants the
          recommendation, and a row of inputs would imply otherwise. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          Handicap allowance <b style={{ color: "var(--color-text)" }}>{info.allowance}%</b>
          {info.allowanceOverridden
            ? ` — set by your committee, in place of the usual ${info.recommendedAllowance}%.`
            : info.allowanceIsConvention
              ? " — the common club convention for this format, not a published standard."
              : " — the recommended allowance for this format."}
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: "2px 10px", fontSize: 12 }}
          onClick={() => {
            setAllowance(String(info.allowance));
            setEditingAllowance((o) => !o);
          }}
        >
          {editingAllowance ? "Cancel" : "Change"}
        </button>
      </div>

      {editingAllowance && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            className="input"
            inputMode="numeric"
            style={{ width: 90 }}
            value={allowance}
            onChange={(e) => setAllowance(e.target.value)}
            aria-label="Handicap allowance percent"
          />
          <span className="text-muted" style={{ fontSize: 12 }}>% of course handicap</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              const n = parseInt(allowance, 10);
              run(() => setStageAllowance(stageId, Number.isFinite(n) ? n : -1));
              setEditingAllowance(false);
            }}
          >
            Save
          </button>
          {info.allowanceOverridden && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => {
                run(() => setStageAllowance(stageId, 0));
                setEditingAllowance(false);
              }}
            >
              Back to {info.recommendedAllowance}%
            </button>
          )}
        </div>
      )}

      {/* Only formats scored by a per-player split get this. A flat percentage
          cannot express greensomes' 60/40, and offering the control to a
          format that doesn't use one would be a control with nothing behind it. */}
      {info.shares && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            Handicap split <b style={{ color: "var(--color-text)" }}>{info.shares.join(" / ")}</b>
            {info.sharesOverridden
              ? ` — set by your committee, in place of the usual ${info.recommendedShares?.join(" / ")}.`
              : " — the recommended split for this format."}
            <FieldInfo label="the handicap split">
              <p>
                The shares are applied best player first: the first number is the percentage of the{" "}
                <b>lower</b> handicap, the second the percentage of the <b>higher</b>.
              </p>
              <p>
                Greensomes is 60 / 40 because taking the better of two drives is an advantage, so the
                side plays off fewer strokes than an alternate-shot pair of the same two players.
              </p>
              <p>The shares do not have to add up to 100.</p>
            </FieldInfo>
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "2px 10px", fontSize: 12 }}
            onClick={() => {
              setShares(info.shares!.map(String));
              setEditingShares((o) => !o);
            }}
          >
            {editingShares ? "Cancel" : "Change"}
          </button>
        </div>
      )}

      {editingShares && info.shares && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {shares.map((v, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <input
                className="input"
                inputMode="numeric"
                style={{ width: 70 }}
                value={v}
                onChange={(e) => setShares((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
                aria-label={i === 0 ? "Share of the lower handicap, percent" : `Share ${i + 1}, percent`}
              />
              <span className="text-muted" style={{ fontSize: 12 }}>%</span>
            </span>
          ))}
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              const nums = shares.map((s) => parseInt(s, 10));
              run(() => setStageAllowanceWeights(stageId, nums.map((n) => (Number.isFinite(n) ? n : -1))));
              setEditingShares(false);
            }}
          >
            Save
          </button>
          {info.sharesOverridden && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => {
                run(() => setStageAllowanceWeights(stageId, []));
                setEditingShares(false);
              }}
            >
              Back to {info.recommendedShares?.join(" / ")}
            </button>
          )}
        </div>
      )}

      {/* Only where separate balls are aggregated. A scramble already plays a
          single ball, so the question doesn't arise. */}
      {info.countBest !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            Scores that count{" "}
            <b style={{ color: "var(--color-text)" }}>
              best {info.countBest} of {info.maxSide}
            </b>
            {info.countBestOverridden ? " — set by your committee." : " — how this format is normally played."}
            <FieldInfo label="how many scores count">
              <p>
                On each hole the side&rsquo;s best{" "}
                {info.countBest === 1 ? "score counts" : `${info.countBest} scores count`} and the rest
                are set aside.
              </p>
              <p>
                Counting more than one keeps everybody involved: with only the best ball counting,
                three of a four have nothing to play for once a partner makes par. &ldquo;Best 2 of
                4&rdquo; is the usual society choice.
              </p>
            </FieldInfo>
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "2px 10px", fontSize: 12 }}
            onClick={() => {
              setCountBest(String(info.countBest ?? 1));
              setEditingCount((o) => !o);
            }}
          >
            {editingCount ? "Cancel" : "Change"}
          </button>
        </div>
      )}

      {editingCount && info.countBest !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select
            className="input"
            style={{ width: 150 }}
            value={countBest}
            onChange={(e) => setCountBest(e.target.value)}
            aria-label="How many scores count on each hole"
          >
            {Array.from({ length: info.maxSide }, (_, i) => i + 1).map((n) => (
              <option key={n} value={String(n)}>
                best {n} of {info.maxSide}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              const n = parseInt(countBest, 10);
              run(() => setStageCountBest(stageId, Number.isFinite(n) ? n : 0));
              setEditingCount(false);
            }}
          >
            Save
          </button>
          {info.countBestOverridden && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => {
                run(() => setStageCountBest(stageId, 0));
                setEditingCount(false);
              }}
            >
              Back to best 1
            </button>
          )}
        </div>
      )}

      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
