"use client";
import { useState } from "react";
import { ScoreImport } from "./ScoreImport";
import { Icon } from "./Icon";
import type { FieldPlayer } from "@/lib/domain/score-import";

/**
 * "Import scores" on a team round's entry screen (2026-10-10) — the same
 * importer the individual screen opens, filing each row on its side. Staff
 * only; the page decides that, and `importTeamScores` refuses anybody else.
 */
export function TeamScoreImport({
  stageId,
  format,
  holes,
  field,
  team,
}: {
  stageId: string;
  format: string;
  holes: number;
  field: FieldPlayer[];
  team: { shared: boolean; sides: { id: string; name: string }[] };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 16 }}>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ fontSize: 13, padding: "3px 9px" }}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="upload-simple" /> {open ? "Close import" : "Import scores"}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <ScoreImport
            stageId={stageId}
            format={format}
            holes={holes}
            field={field}
            team={team}
            onDone={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
