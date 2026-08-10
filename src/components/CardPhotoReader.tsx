"use client";
import { useRef, useState, useTransition } from "react";
import { readScorecardPhoto } from "@/app/actions/card-photo";
import FieldInfo from "@/components/FieldInfo";

/**
 * Read a paper card from a photograph, then hand the numbers to a person.
 *
 * The contract this screen exists to make visible: NOTHING IS SAVED HERE.
 * The reading is a proposal. It fills the boxes an organizer would have typed
 * into, they check it against the card in their hand, and it is their submit
 * that writes anything — through the ordinary path, with every existing guard
 * still in force.
 *
 * So the design leans on doubt rather than confidence. Holes the reader could
 * not make out are left blank and pointed at, because a blank asks a question
 * and a wrong number does not.
 */

export interface CardPhotoReaderProps {
  stageId: string;
  playerId: string;
  playerName: string;
  holeCount: number;
  /** Called with the proposed scores. The caller decides what to do with them. */
  onReading: (strokes: (number | null)[]) => void;
}

/** Downscale before upload: a 12-megapixel photo is far more than is needed to
 *  read two-digit numbers, and it costs the organizer's data on a phone. */
async function shrink(file: File, maxEdge = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function CardPhotoReader({
  stageId,
  playerId,
  playerName,
  holeCount,
  onReading,
}: CardPhotoReaderProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const handle = (file: File | undefined) => {
    if (!file) return;
    setError("");
    setNote("");
    startTransition(async () => {
      let dataUrl: string;
      try {
        dataUrl = await shrink(file);
      } catch {
        setError("Couldn't read that image. Try another photo.");
        return;
      }
      const res = await readScorecardPhoto(stageId, playerId, dataUrl);
      if (!res.ok || !res.reading) {
        setError(res.error ?? "Couldn't read the card.");
        return;
      }
      const { strokes, unreadable, empty } = res.reading;
      onReading(strokes);
      if (empty) {
        setError("Nothing could be read from that photo. Type the scores in, or try a clearer one.");
      } else if (unreadable.length > 0) {
        // Named rather than counted: the organizer needs to know WHICH holes
        // to look at, and a count sends them hunting.
        setNote(
          `Filled in what could be read. Check ${unreadable.length === 1 ? "hole" : "holes"} ${unreadable.join(", ")} — ${unreadable.length === 1 ? "it was" : "they were"} left blank.`,
        );
      } else {
        setNote("Filled in. Check it against the card before saving.");
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
        >
          <i className="ph ph-camera" /> {pending ? "Reading…" : "Read from a photo"}
        </button>
        <FieldInfo label="reading a card from a photo">
          <p>
            Photograph {playerName}&rsquo;s card and the scores are filled in for you to check.
            <b> Nothing is saved until you save it</b> — this only fills the boxes.
          </p>
          <p>
            Anything that can&rsquo;t be read clearly is left blank rather than guessed, and the
            holes to look at are named.
          </p>
        </FieldInfo>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          // capture hints a phone toward its camera; a laptop ignores it and
          // shows the file picker, which is the right behaviour on both.
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            handle(e.target.files?.[0]);
            // Cleared so photographing the same card twice still fires.
            e.target.value = "";
          }}
        />
      </div>

      {note && (
        <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
          <i className="ph ph-info" /> {note}
        </p>
      )}
      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)", lineHeight: 1.5 }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
      <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
        {holeCount} holes · the photo is read and not kept
      </p>
    </div>
  );
}
