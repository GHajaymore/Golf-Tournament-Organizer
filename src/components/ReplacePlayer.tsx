"use client";
import { useMemo, useState, useTransition } from "react";
import { replaceInTeeSheet } from "@/app/actions/tee-sheet";
import { NO_INDEX, readHandicapIndex, indexFigure } from "@/lib/domain/handicap-label";
import {
  REPLACE_REASONS,
  REPLACE_REASON_WORDS,
  guestFigureRefusal,
  replaceCandidates,
  replaceWillSay,
  type ReplaceCandidate,
  type ReplaceReason,
  type ReplaceWorld,
} from "@/lib/domain/tee-sheet-replace";
import { Icon } from "./Icon";

const GUEST_CHOICE = "__guest";

/**
 * "REPLACE …" BESIDE A PLAYER IN A GROUP THAT HAS NOT STARTED (B43).
 *
 * A small panel under the name, not a dialog: who steps in (a member who is not already playing this
 * week — the ones who cannot are listed greyed, each with its reason — or a guest, with a handicap typed
 * now), why, and ONE confirm that states in one sentence what will happen. The choices are
 * `replaceCandidates`, the function the server refuses by. A refusal is said here, where the press was.
 */
export function ReplacePlayer({
  stageId,
  savedAt,
  player,
  group,
  candidates,
  world,
  inSides,
  weekly,
  scoringBasis,
  disabled = false,
  door = null,
  onSaid,
}: {
  /** Why nobody can be swapped now (`fieldRefusal(…, "place-in-group")`), or null: said instead of the button. */
  door?: string | null;
  stageId: string;
  /** The saved sheet's `savedAt`, so a sheet changed meanwhile is refused with a sentence. */
  savedAt: string;
  player: { id: string; name: string };
  group: { name: string; time: string };
  candidates: ReplaceCandidate[];
  world: ReplaceWorld;
  /** Partners play together: the substitute takes the place in the pair. */
  inSides: boolean;
  /** The tournament asks each week, so the absentee is marked out for it. */
  weekly: boolean;
  /** The round's `scoringBasis`: anything but "gross" uses handicaps, so a guest needs a figure. */
  scoringBasis: string;
  disabled?: boolean;
  /** What the press did, said by the screen — this player is off the sheet afterwards, so it cannot say it here. */
  onSaid: (said: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestIndex, setGuestIndex] = useState("");
  const [reason, setReason] = useState<ReplaceReason>("no-show");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const choices = useMemo(() => replaceCandidates(candidates, player.id, world), [candidates, player.id, world]);
  const guest = pick === GUEST_CHOICE;
  const member = choices.find((c) => c.id === pick && !c.why) ?? null;

  // What a guest's box says, the way every box reads one; a blank is "no index", never nought.
  const typed = readHandicapIndex(guestIndex);
  const guestIndexWords = typed.kind === "index" ? indexFigure(typed.value) : NO_INDEX;
  const guestBad = guest && (typed.kind === "unreadable" || typed.kind === "out-of-range");
  // In a round scored net a guest needs a figure (`guestFigureRefusal`): never played off nought.
  const needsFigure = guest && !!guestFigureRefusal(scoringBasis, guestName.trim() || "the guest", typed.kind === "index");
  const ready = !pending && (guest ? guestName.trim().length > 0 && !guestBad && !needsFigure : !!member);
  const subName = guest ? guestName.trim() : member?.name ?? "";
  const subIndex = guest ? guestIndexWords : member?.index ?? "";
  // The committee's strokes for this round, which the round plays off before any index (a guest has none yet).
  const subFigure = member ? (world.figures[member.id] ?? null) : null;

  const press = () => {
    setError("");
    startTransition(async () => {
      const res = await replaceInTeeSheet(
        stageId,
        savedAt,
        player.id,
        guest ? { kind: "guest", name: guestName.trim(), index: guestIndex } : { kind: "member", playerId: pick },
        reason,
      );
      if (res.ok) {
        setOpen(false);
        onSaid(res.said ?? "");
      } else {
        setError(res.error ?? "That did not save.");
      }
    });
  };

  if (door) {
    return (
      <p className="text-muted" style={{ margin: "4px 0", fontSize: 13 }}>
        {door}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-secondary"
        style={{ minHeight: 44, margin: "4px 0", fontSize: 13, alignSelf: "flex-start" }}
        disabled={disabled}
        aria-label={`Replace ${player.name}`}
        onClick={() => setOpen(true)}
      >
        <Icon name="user-plus" /> Replace…
      </button>
    );
  }

  return (
    <div role="group" aria-label={`Replace ${player.name}`} style={{ display: "flex", flexDirection: "column", gap: 8, margin: "4px 0 8px", minWidth: 0 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        Who takes {player.name}’s place
        <select aria-label={`Who replaces ${player.name}`} className="input" style={{ minWidth: 0, minHeight: 44 }} value={pick} disabled={pending} onChange={(e) => { setPick(e.target.value); setError(""); }}>
          <option value="">Choose…</option>
          {choices.filter((c) => !c.why).map((c) => (
            <option key={c.id} value={c.id}>{`${c.name} · ${c.index}`}</option>
          ))}
          <option value={GUEST_CHOICE}>A guest (not a member)…</option>
          {choices.filter((c) => c.why).map((c) => (
            <option key={c.id} value={c.id} disabled>{`${c.name} — ${c.why}`}</option>
          ))}
        </select>
      </label>
      {guest && (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Guest’s name
            <input className="input" style={{ minWidth: 0, minHeight: 44 }} value={guestName} maxLength={80} autoComplete="off" disabled={pending} onChange={(e) => setGuestName(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Handicap index
            <input className="input" style={{ minWidth: 0, minHeight: 44 }} inputMode="decimal" value={guestIndex} autoComplete="off" disabled={pending} onChange={(e) => setGuestIndex(e.target.value)} />
            <span className="text-muted">
              {!world.net ? "Leave blank: they play gross only." : `Type the handicap the committee gives ${guestName.trim() || "the guest"} — this round is scored net.`}
            </span>
          </label>
          {guestBad && <p className="form-error" role="alert" style={{ margin: 0 }}>Enter the handicap as a number, like 12.4 — or +2.4 for a plus handicap.</p>}
        </>
      )}
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        Why
        <select aria-label={`Why ${player.name} is replaced`} className="input" style={{ minWidth: 0, minHeight: 44 }} value={reason} disabled={pending} onChange={(e) => setReason(e.target.value as ReplaceReason)}>
          {REPLACE_REASONS.map((r) => (
            <option key={r} value={r}>{REPLACE_REASON_WORDS[r]}</option>
          ))}
        </select>
      </label>
      {ready && (
        <p role="note" className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          {replaceWillSay({ absentee: player.name, sub: subName, group: group.name, time: group.time, handicap: subIndex, figure: subFigure, inSides, weekly })}
        </p>
      )}
      {error && <p className="form-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={!ready} onClick={press}>
          {pending ? "Replacing…" : `Replace ${player.name}`}
        </button>
        <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} disabled={pending} onClick={() => { setOpen(false); setError(""); }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
