"use client";
import { useState } from "react";
import Link from "next/link";
import { setCupSettings } from "@/app/actions/cup";
import { figureOr, readDecimal } from "@/lib/domain/decimal-text";
import { bringIntoView } from "@/lib/bring-into-view";
import { ScopeLockMark } from "@/components/ScopeLockBanner";
import { SCOPE_WORDS, type ScopeLock } from "@/lib/domain/tournament-status";

/**
 * THE CUP'S OWN TILE (R4, the move): points to win and who holds the cup on a tie. It lived on the cup page's
 * lineup; lifted so Rounds & formats can mount the same form (phase 1 section 6, Q5: the cup's settings are
 * rounds-scope settings). `run` is the caller's one way to press an action and say its refusal.
 */
type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => void;
interface Team {
  id: string;
  name: string;
}

export function CupTile({
  teams,
  pointsToWin,
  holder,
  locked,
  lockWhy,
  pending,
  run,
}: {
  teams: [Team, Team];
  pointsToWin: number;
  holder: string;
  locked: boolean;
  lockWhy: ScopeLock | null;
  pending: boolean;
  run: Run;
}) {
  const [target, setTarget] = useState(pointsToWin > 0 ? String(pointsToWin) : "");
  const [who, setWho] = useState(holder);
  /** The figure refused, said beside Save. */
  const [said, setSaid] = useState("");
  return (
    <form
      className="card elev-sm"
      style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}
      onSubmit={(e) => {
        e.preventDefault();
        // "14,5" is fourteen and a half (`decimalPoint`): read as nothing, it set the cup back to
        // "more than half" without a word. An empty box IS "more than half"; anything else that is
        // not a figure is refused beside Save — "abc" did the same as "14,5" until 2026-10-21 (the
        // text-box crawl).
        const read = readDecimal(target.replace("½", ".5"));
        const points = read.kind === "blank" ? 0 : figureOr(read, Number.NaN);
        if (!Number.isFinite(points) || points < 0 || points > 200 || Math.round(points * 2) !== points * 2) {
          setSaid("Points to win is a whole or half number, like 14½ — or leave it empty for more than half.");
          return;
        }
        setSaid("");
        run(() => setCupSettings(points, who));
      }}
    >
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        Points to win
        <input
          id="cup-target"
          className="input"
          inputMode="decimal"
          value={target}
          placeholder="More than half"
          onChange={(e) => setTarget(e.target.value)}
          style={{ width: 140 }}
        />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        Holder (keeps it on a tie)
        <select id="cup-holder" className="input" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Nobody — a tie is shared</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-secondary" disabled={pending || locked} aria-describedby={locked && lockWhy ? "cup-settings-why" : undefined}>
        Save
      </button>
      {locked && <ScopeLockMark />}
      {locked && lockWhy && (
        // THE REASON, WHERE THE PERSON IS (G663-1): Save is greyed and the banner may be off the screen. The machine's
        // own words and way out, beside the control, named by Save's aria-describedby.
        <p id="cup-settings-why" data-lock-why style={{ margin: 0, flexBasis: "100%", fontSize: 14, lineHeight: 1.5 }}>
          <b>{SCOPE_WORDS[lockWhy.scope]}</b> · {lockWhy.because}{" "}
          {lockWhy.correctable ? (
            <span className="text-muted">The Organizer can make a committee correction, above.</span>
          ) : (
            <Link href={lockWhy.wayOut.href} style={{ color: "var(--color-accent-200)", fontWeight: 600 }}>
              {lockWhy.wayOut.says}
            </Link>
          )}
        </p>
      )}
      {said && (
        <p role="alert" className="form-error" style={{ margin: 0, flexBasis: "100%" }} ref={bringIntoView}>
          {said}
        </p>
      )}
    </form>
  );
}
