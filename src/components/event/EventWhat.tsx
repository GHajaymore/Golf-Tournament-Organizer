"use client";
import { useId } from "react";
import { playKindsFor } from "@/lib/domain/play-kind";
import { eventWords } from "@/lib/domain/event-words";
import { useGolfRegister } from "@/components/GolfTermsProvider";
import { TITLE_MAX } from "@/lib/domain/typed-limits";
import { MoreInfo } from "../MoreInfo";

/**
 * WHAT THIS EVENT IS: its name and what kind it is. Lifted out of `EventSetupClient` (R3-1), no
 * behaviour change; Event (R3) mounts it. The draft stays in the caller's one form, so one Save keeps it.
 */
export function EventWhat({
  name,
  playKind,
  onName,
  onPlayKind,
}: {
  name: string;
  playKind: string;
  onName: (v: string) => void;
  onPlayKind: (v: string) => void;
}) {
  // The club's golf words — "a league or golf group", "a league or society".
  const register = useGolfRegister();
  const words = eventWords(playKind, register);
  // Captions below are real <label>s for their controls (a screen reader said an unnamed "edit text").
  const fid = useId();
  return (
    <>
      <div className="field">
        <label htmlFor={`${fid}-name`}>
          Tournament name{" "}
          {!name.trim() && <span style={{ color: "var(--color-accent-200)" }}>· required to launch</span>}
        </label>
        <input
          id={`${fid}-name`}
          className="input"
          value={name}
          maxLength={TITLE_MAX}
          onChange={(e) => onName(e.target.value)}
          placeholder="Name your tournament"
          style={!name.trim() ? { borderColor: "var(--color-accent)" } : undefined}
        />
      </div>
      {/* WHAT THIS ONE IS CALLED. A club runs a championship in June, a charity scramble in July and a
          roll-up on Tuesdays — one word for all three is wrong however carefully it is chosen, so the
          tournament says which it is and the screens use that word. Copy only: nothing scores differently. */}
      <div className="field">
        <label htmlFor="play-kind">What kind is this?</label>
        <select
          id="play-kind"
          className="input"
          value={playKind}
          onChange={(e) => onPlayKind(e.target.value)}
          style={{ minHeight: 46 }}
        >
          {playKindsFor(register, playKind).map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
        {/* One line, the rest an ⓘ away (Ajay, 2026-10-05). */}
        <MoreInfo short={<>Members see &ldquo;this {words.kindLower}&rdquo;.</>} style={{ marginTop: 6 }}>
          Members see this word: &ldquo;this {words.kindLower}&rdquo;, and the results card
          reads &ldquo;{words.resultHeading}&rdquo;. It changes nothing about how the golf is
          scored.
        </MoreInfo>
      </div>
    </>
  );
}
