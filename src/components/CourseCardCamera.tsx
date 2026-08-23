"use client";
import { useRef, useState, useTransition } from "react";
import { readCourseCardPhoto } from "@/app/actions/card-photo";
import FieldInfo from "@/components/FieldInfo";
import { LockedFeature } from "@/components/LockedFeature";
import { shrinkPhoto } from "@/lib/photo-upload";

/**
 * Photograph the club's card instead of typing fifty-four numbers.
 *
 * It fills the boxes below and stops there. That is not a limitation, it is
 * the design: the review those boxes already run — every problem at once, the
 * hole named, refusing to save a card that does not reconcile — is stricter
 * than anything a reader could promise, and it is the same review a pasted or
 * typed card gets. So the camera earns its place by removing the typing, not
 * by being trusted.
 *
 * A club's card is the highest-stakes data in the product. It is entered once
 * and then scores every round played there forever, and a stroke index off by
 * one hole never looks wrong again — it just gives shots to the wrong holes.
 * Hence the wording throughout: this proposes, and a person confirms against
 * the card in their hand.
 */

export interface CourseCardCameraProps {
  holes: 9 | 18;
  /** Called with the three rows, as text, for the boxes below. */
  onReading: (rows: { pars: string; strokeIndex: string; yards: string }) => void;
  disabled?: boolean;
  /** False when this club's plan doesn't include card reading. */
  available?: boolean;
}

/** "hole 4" / "holes 4, 9 and 11" — named, because a count sends somebody hunting. */
function holeList(holes: number[]): string {
  const word = holes.length === 1 ? "hole" : "holes";
  if (holes.length <= 1) return `${word} ${holes.join("")}`;
  return `${word} ${holes.slice(0, -1).join(", ")} and ${holes[holes.length - 1]}`;
}

export function CourseCardCamera({
  holes,
  onReading,
  disabled = false,
  available = true,
}: CourseCardCameraProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<string[]>([]);

  const handle = (file: File | undefined) => {
    if (!file) return;
    setError("");
    setNotes([]);
    startTransition(async () => {
      let dataUrl: string;
      try {
        dataUrl = await shrinkPhoto(file);
      } catch {
        setError("Couldn't read that image. Try another photo.");
        return;
      }
      const res = await readCourseCardPhoto(dataUrl, holes);
      if (!res.ok || !res.reading) {
        setError(res.error ?? "Couldn't read the card.");
        return;
      }
      const r = res.reading;
      if (r.empty) {
        setError(
          "Nothing could be read from that photo. Type the card in below, or try a straighter, closer one.",
        );
        return;
      }

      onReading({ pars: r.pars, strokeIndex: r.strokeIndex, yards: r.yards });

      const lines: string[] = [];
      // Blanks come back as 0, so the check below already flags each one
      // against its own hole. Naming them here as well is what turns "a par
      // should be 3, 4, 5 or occasionally 6" into somewhere to look.
      if (r.unreadable.pars.length > 0) lines.push(`Par — couldn't read ${holeList(r.unreadable.pars)}.`);
      if (r.unreadable.strokeIndex.length > 0) {
        lines.push(`Stroke index — couldn't read ${holeList(r.unreadable.strokeIndex)}.`);
      }
      if (r.unreadable.yards.length > 0) {
        lines.push(`Yardage — couldn't read ${holeList(r.unreadable.yards)}.`);
      }
      if (r.yardsDropped) {
        lines.push("Yardage — not readable on this photo, so it was left out. Nothing scores off it.");
      }
      lines.push("Check every row against the card before saving. Nothing has been saved yet.");
      setNotes(lines);
    });
  };

  // Locked before the work, not after it.
  if (!available) {
    return <LockedFeature feature="cardScan" insteadOf="Paste or type the rows below as usual." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending || disabled}
          onClick={() => fileRef.current?.click()}
        >
          <i className="ph ph-camera" /> {pending ? "Reading…" : "Photograph the card"}
        </button>
        <FieldInfo label="photographing a course card">
          <p>
            Take a photo of the club&rsquo;s printed card and the par, stroke index and yardage rows
            are filled in below for you to check.
            <b> Nothing is saved until you save it.</b>
          </p>
          <p>
            The rows are then checked exactly as a pasted card is — a duplicate stroke index or a
            hole that doesn&rsquo;t reconcile is named before it can be saved.
          </p>
          <p>
            Anything that can&rsquo;t be read is left blank rather than guessed. A blank shows up as
            a problem against that hole, which is what you want: this card scores every round
            played at the course from now on.
          </p>
        </FieldInfo>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            handle(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <span className="text-muted" style={{ fontSize: 12 }}>
          {holes} holes · the photo is read and not kept
        </span>
      </div>

      {notes.length > 0 && (
        <ul
          className="text-muted"
          style={{ fontSize: 12, margin: 0, paddingLeft: 18, lineHeight: 1.6 }}
        >
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)", lineHeight: 1.5 }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
