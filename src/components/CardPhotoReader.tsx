"use client";
import { useRef, useState, useTransition } from "react";
import { readScorecardPhoto, readGroupCardPhoto } from "@/app/actions/card-photo";
import FieldInfo from "@/components/FieldInfo";
import { LockedFeature } from "@/components/LockedFeature";

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
 *
 * ONE BUTTON, WHOEVER IS ON THE CARD. A fourball shares one piece of paper, so
 * photographing it once per player is four uploads and four times the cost for
 * one card — and the scorer has to notice they were supposed to do that. The
 * number of players on the card decides which reading is asked for; there is
 * no second control and nothing to switch on. That count is derived from the
 * tee group the scorer already selected.
 */

export interface CardPhotoReaderProps {
  stageId: string;
  /**
   * Everybody on the card being scored, in tee-sheet order. One player is the
   * ordinary case and reads exactly as it did before.
   */
  players: ReadonlyArray<{ id: string; name: string }>;
  holeCount: number;
  /** Called with the proposed scores, per player. The caller decides what to
   *  do with them — this component never saves. */
  onReading: (rows: Array<{ playerId: string; strokes: (number | null)[] }>) => void;
  /** False when this club's plan doesn't include card reading. The section is
   *  still rendered — as a visible locked state, before any work is done. */
  available?: boolean;
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

/** "hole 4" / "holes 4, 9 and 11" — named, because a count sends somebody hunting. */
function holeList(holes: number[]): string {
  const word = holes.length === 1 ? "hole" : "holes";
  if (holes.length <= 1) return `${word} ${holes.join("")}`;
  return `${word} ${holes.slice(0, -1).join(", ")} and ${holes[holes.length - 1]}`;
}

export function CardPhotoReader({
  stageId,
  players,
  holeCount,
  onReading,
  available = true,
}: CardPhotoReaderProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  // Rows the reader could not place. Held apart from the notes because this is
  // the one outcome the scorer must act on rather than merely check.
  const [orphans, setOrphans] = useState<string[]>([]);

  const solo = players.length === 1 ? players[0] : null;

  const handle = (file: File | undefined) => {
    if (!file || players.length === 0) return;
    setError("");
    setNotes([]);
    setOrphans([]);
    startTransition(async () => {
      let dataUrl: string;
      try {
        dataUrl = await shrink(file);
      } catch {
        setError("Couldn't read that image. Try another photo.");
        return;
      }

      if (solo) {
        const res = await readScorecardPhoto(stageId, solo.id, dataUrl);
        if (!res.ok || !res.reading) {
          setError(res.error ?? "Couldn't read the card.");
          return;
        }
        const { strokes, unreadable, empty } = res.reading;
        onReading([{ playerId: solo.id, strokes }]);
        if (empty) {
          setError("Nothing could be read from that photo. Type the scores in, or try a clearer one.");
        } else if (unreadable.length > 0) {
          // Named rather than counted: the organizer needs to know WHICH holes
          // to look at, and a count sends them hunting.
          setNotes([`Filled in what could be read. Check ${holeList(unreadable)} — left blank.`]);
        } else {
          setNotes(["Filled in. Check it against the card before saving."]);
        }
        return;
      }

      const res = await readGroupCardPhoto(stageId, players.map((p) => p.id), dataUrl);
      if (!res.ok || !res.reading) {
        setError(res.error ?? "Couldn't read the card.");
        return;
      }
      const { rows, unmatched, missing, empty } = res.reading;
      onReading(rows.map((r) => ({ playerId: r.playerId, strokes: r.reading.strokes })));
      if (empty) {
        setError("Nothing could be read from that photo. Type the scores in, or try a clearer one.");
        return;
      }

      // A line per player, naming their own blanks. One combined sentence for
      // four players reads as a wall and gets skipped, and the whole point is
      // that somebody looks.
      const lines = rows.map((r) => {
        const who = players.find((p) => p.id === r.playerId)?.name ?? r.readAs;
        const blanks = r.reading.unreadable;
        return blanks.length > 0
          ? `${who} — filled in, check ${holeList(blanks)}.`
          : `${who} — filled in.`;
      });
      // Missing is a note rather than an error: one player in a fourball not
      // having a row is normal on a card still being written.
      for (const m of missing) lines.push(`${m.name} — no row found on this card. Type it in.`);
      setNotes(lines);
      setOrphans(unmatched);
    });
  };

  // Locked BEFORE the work, not after it. Discovering this by photographing a
  // card, waiting for the upload, and then being refused is the version of
  // this that makes somebody give up on the product rather than buy it.
  if (!available) {
    return (
      <LockedFeature feature="cardScan" insteadOf="Type the scores in below as usual." />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending || players.length === 0}
          onClick={() => fileRef.current?.click()}
        >
          <i className="ph ph-camera" />{" "}
          {pending ? "Reading…" : solo ? "Read from a photo" : "Read the whole card"}
        </button>
        <FieldInfo label="reading a card from a photo">
          <p>
            {solo ? (
              <>Photograph {solo.name}&rsquo;s card and the scores are filled in for you to check.</>
            ) : (
              <>
                Photograph the card once and every player&rsquo;s row is filled in — you don&rsquo;t
                need a photo each.
              </>
            )}
            <b> Nothing is saved until you save it</b> — this only fills the boxes.
          </p>
          <p>
            Anything that can&rsquo;t be read clearly is left blank rather than guessed, and the
            holes to look at are named.
          </p>
          {!solo && (
            <p>
              A row whose name can&rsquo;t be matched to a player in this group is reported rather
              than given to whoever is left over — the app will not guess whose round it is.
            </p>
          )}
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
      {orphans.length > 0 && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-warning)", lineHeight: 1.5 }}>
          <i className="ph ph-warning-circle" /> Read {orphans.length === 1 ? "a row" : "rows"} for{" "}
          <b>{orphans.join(", ")}</b>, who {orphans.length === 1 ? "is" : "are"} not in this group.
          Those scores were left out — check you photographed the right card.
        </p>
      )}
      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)", lineHeight: 1.5 }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
      <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
        {holeCount} holes ·{" "}
        {solo
          ? "the photo is read and not kept"
          : `${players.length} players on this card · the photo is read and not kept`}
      </p>
    </div>
  );
}
