"use client";
import { useMemo, useState, useTransition } from "react";
import { importScores } from "@/app/actions/tournament";
import {
  parseScoreCsv,
  importShapesFor,
  isStrokeShape,
  templateCsv,
  IMPORT_SHAPES,
  type ScoreImportShape,
  type FieldPlayer,
} from "@/lib/domain/score-import";
import type { HoleResult } from "@/lib/domain";

/**
 * Bulk score import.
 *
 * Checked before it is offered, not after it is applied. The file is parsed as
 * it is pasted or dropped, every name is resolved against the actual field,
 * and the count of rows that will land is shown next to the count that will
 * not — with reasons. Nothing is written until someone reads that and presses
 * the button.
 *
 * The alternative, which is what most importers do, is to accept the file and
 * report failures afterwards. On a tee sheet that means finding out at the
 * prizegiving that eleven cards never arrived.
 */
export function ScoreImport({
  stageId,
  format,
  holes,
  field,
  onDone,
}: {
  stageId: string;
  /** The round's format — decides which file shapes are even offered. */
  format: string;
  holes: number;
  field: FieldPlayer[];
  onDone?: () => void;
}) {
  const allowed = useMemo(() => importShapesFor(format), [format]);
  const [shape, setShape] = useState<ScoreImportShape>(allowed[0]);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ written: number; problems?: string[] } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const shapes = IMPORT_SHAPES.filter((s) => allowed.includes(s.key));
  const active = shapes.find((s) => s.key === shape) ?? shapes[0];

  // Parsed live, so the verdict is visible before anything is committed.
  const parsed = useMemo(
    () => (text.trim() ? parseScoreCsv(text, active.key, field, holes) : null),
    [text, active.key, field, holes],
  );

  const readFile = (file: File) => {
    setError("");
    setResult(null);
    file
      .text()
      .then(setText)
      .catch(() => setError("Couldn't read that file."));
  };

  const apply = () => {
    if (!parsed || parsed.ready === 0) return;
    setError("");
    startTransition(async () => {
      // Which list the parser filled, not which literal the shape is: a net
      // file fills strokeRows exactly as a gross one does, and testing for
      // "strokes" alone sent the server an empty array.
      const rows =
        isStrokeShape(active.key)
          ? parsed.strokeRows.map((r) => ({ playerId: r.playerId, strokes: r.strokes }))
          : parsed.matchRows.map((r) => ({
              aId: r.aId,
              bId: r.bId,
              holes: r.holes as HoleResult[] | undefined,
              winner: r.winner,
              margin: r.margin,
            }));
      const res = await importScores(stageId, active.key, rows);
      if (!res.ok) {
        setError(res.error ?? "Nothing could be imported.");
        return;
      }
      setResult({ written: res.written, problems: res.problems });
      setText("");
      onDone?.();
    });
  };

  return (
    <div className="card elev-sm" style={{ gap: 14 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>Import scores from a file</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0", maxWidth: "70ch", lineHeight: 1.5 }}>
          Paste a CSV or drop the file in. Every row is checked against this tournament&rsquo;s field before
          anything is written.
        </p>
      </div>

      {/* Only the shapes this format can score. A Stableford round has no hole
          winner to import and no match margin to record. */}
      {shapes.length > 1 ? (
        <div className="mode-pick">
          {shapes.map((s) => (
            <button
              key={s.key}
              type="button"
              className="mode-opt"
              aria-pressed={s.key === active.key}
              disabled={pending}
              onClick={() => {
                setShape(s.key);
                setResult(null);
              }}
            >
              <span className="mode-opt-head">{s.label}</span>
              <span className="mode-opt-blurb">{s.blurb}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
          {active.blurb}
        </p>
      )}

      {/* The spec, in full, next to the box it describes. An importer that
          only shows a placeholder makes the organizer guess at heading names
          and discover the answer by failing. */}
      <details open>
        <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
          What the file needs
        </summary>
        <div className="sc-wrap" style={{ marginBottom: 8 }}>
          <table className="sc" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Heading</th>
                <th style={{ textAlign: "left" }}>Required</th>
                <th style={{ textAlign: "left" }}>What goes in it</th>
              </tr>
            </thead>
            <tbody>
              {active.columns.map((c) => (
                <tr key={c.heading}>
                  <td style={{ fontFamily: "var(--font-mono, monospace)", whiteSpace: "nowrap" }}>{c.heading}</td>
                  <td style={{ textAlign: "left" }}>
                    {c.required ? (
                      <span className="tag tag-accent" style={{ fontSize: 10 }}>Required</span>
                    ) : (
                      <span className="text-muted" style={{ fontSize: 11 }}>Optional</span>
                    )}
                  </td>
                  <td style={{ textAlign: "left", whiteSpace: "normal", lineHeight: 1.45, minWidth: 260 }}>
                    {c.accepts}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted" style={{ fontSize: 11.5, margin: "0 0 4px", lineHeight: 1.5 }}>
          Row 1 is the header. Headings are matched loosely — case and spacing don&rsquo;t matter, and columns
          may appear in any order. Anything the app doesn&rsquo;t recognise is ignored rather than rejected.
        </p>
        <pre
          style={{
            margin: 0,
            padding: "8px 10px",
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg)",
            boxShadow: "inset 0 0 0 1px var(--color-divider)",
            fontSize: 11.5,
            overflowX: "auto",
          }}
        >
          {`${templateCsv(active.key, holes)}
${active.sampleRow}`}
        </pre>
      </details>

      <div className="field">
        <label>
          The file <span className="text-muted">— first row is the header</span>
        </label>
        <textarea
          className="input"
          rows={6}
          value={text}
          disabled={pending}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          onDrop={(e) => {
            const file = e.dataTransfer.files?.[0];
            if (file) {
              e.preventDefault();
              readFile(file);
            }
          }}
          placeholder={templateCsv(active.key, holes)}
          style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, minHeight: 120 }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          <label className="btn btn-secondary" style={{ fontSize: 12, padding: "3px 9px", cursor: "pointer" }}>
            <i className="ph ph-upload-simple" /> Choose a file
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              hidden
              disabled={pending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readFile(f);
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: "3px 9px" }}
            disabled={pending}
            onClick={() => setText(templateCsv(active.key, holes))}
          >
            <i className="ph ph-table" /> Start from the header row
          </button>
        </div>
      </div>

      {/* The verdict, before anything is written. */}
      {parsed && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: "var(--radius-md)",
            fontSize: 12.5,
            lineHeight: 1.5,
            background:
              parsed.ready > 0
                ? "color-mix(in srgb, var(--color-accent-2) 12%, transparent)"
                : "color-mix(in srgb, var(--color-danger) 12%, transparent)",
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${
              parsed.ready > 0 ? "var(--color-accent-2)" : "var(--color-danger)"
            } 30%, transparent)`,
          }}
        >
          <strong>
            {parsed.ready} of {parsed.seen} row{parsed.seen === 1 ? "" : "s"} ready to import
          </strong>
          {parsed.problems.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {parsed.problems.slice(0, 8).map((p, i) => (
                <li key={i}>
                  Row {p.row}: {p.message}
                </li>
              ))}
              {parsed.problems.length > 8 && (
                <li className="text-muted">…and {parsed.problems.length - 8} more.</li>
              )}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
      {result && (
        <div style={{ fontSize: 12.5 }}>
          <p style={{ margin: 0, color: "var(--color-accent-2-400)" }}>
            <i className="ph ph-check" /> Imported {result.written} row{result.written === 1 ? "" : "s"}. They
            sit as pending until approved, the same as a typed card.
          </p>
          {result.problems?.map((p, i) => (
            <p key={i} style={{ margin: "4px 0 0", color: "var(--color-danger)" }}>
              <i className="ph ph-warning-circle" /> {p}
            </p>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || !parsed || parsed.ready === 0}
          onClick={apply}
        >
          <i className="ph ph-download-simple" />{" "}
          {pending ? "Importing…" : parsed ? `Import ${parsed.ready} row${parsed.ready === 1 ? "" : "s"}` : "Import"}
        </button>
        {parsed && parsed.ready < parsed.seen && parsed.ready > 0 && (
          <span className="text-muted" style={{ fontSize: 12 }}>
            The {parsed.seen - parsed.ready} row{parsed.seen - parsed.ready === 1 ? "" : "s"} above are skipped.
          </span>
        )}
      </div>
    </div>
  );
}
