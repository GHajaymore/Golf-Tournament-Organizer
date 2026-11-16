import Link from "next/link";
import { GIVE_STROKES, NEEDS_STROKES_ANCHOR } from "@/lib/domain/committee-figure";

/**
 * THE DOOR'S NOTE (lane N): players with no handicap index in a round scored net, said where they came in
 * (Entries, the sides). It shows the state and never refuses; the sentence is `needsFigureSaid`, built by
 * `needsStrokesNoteFor`, and the link — staff only — opens the band on Rounds & formats.
 */
export function NeedsStrokesNote({ note }: { note: { text: string; link: boolean } | null }) {
  if (!note) return null;
  return (
    <p
      role="note"
      className="card"
      style={{ margin: 0, fontSize: 14, lineHeight: 1.5, borderLeft: "4px solid var(--color-warning)", display: "flex", flexDirection: "row", gap: 12, flexWrap: "wrap", alignItems: "center" }}
    >
      <span style={{ flex: "1 1 260px", minWidth: 0 }}>{note.text}</span>
      {note.link && (
        <Link href={`/stages#${NEEDS_STROKES_ANCHOR}`} className="btn btn-secondary" style={{ minHeight: 44 }}>
          {GIVE_STROKES}
        </Link>
      )}
    </p>
  );
}
