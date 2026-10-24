"use client";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { StampContext } from "./PrintStamp";
import { recordPrinted } from "@/app/actions/print-kit";
import { PAPER_MM, PAPER_NAME, staleSentence, type DocKind, type PaperSize } from "@/lib/domain/print-kit";

export interface HubDoc {
  kind: DocKind;
  title: string;
  what: string;
  unavailable: string;
  /** Each sheet of it, in page order, with the fingerprint it was drawn with. */
  sheets: Array<{ key: string; fp: string; label: string; state: "unprinted" | "current" | "stale"; printedVersion: number }>;
}

/**
 * THE SECRETARY'S MORNING CHECKLIST (decision A): every document the app can
 * make for this round, ticked or not, the paper it goes on, and one button.
 *
 * The pages below are the server's; this owns only what is ticked, the paper,
 * and the press — which records what went to the printer and stamps each
 * sheet before the printer is asked (`recordPrinted`).
 */
export function PrintKitClient({
  stageId,
  rounds,
  roundId,
  paper: paperDefault,
  docs,
  preticked,
  staleOnly,
  gone,
  nowWords,
  children,
}: {
  stageId: string;
  rounds: Array<{ id: string; label: string }>;
  roundId: string;
  paper: PaperSize;
  docs: HubDoc[];
  preticked: DocKind[];
  staleOnly: boolean;
  gone: string[];
  nowWords: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [paper, setPaper] = useState<PaperSize>(paperDefault);
  const [ticked, setTicked] = useState<Set<DocKind>>(new Set(preticked));
  const [onlyStale, setOnlyStale] = useState(staleOnly);
  const [stamps, setStamps] = useState<Record<string, { words: string; version: number }>>({});
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const offered = docs.filter((d) => !d.unavailable && d.sheets.length > 0);
  const stale = offered.flatMap((d) => d.sheets.filter((s) => s.state === "stale"));
  const chosen = onlyStale ? stale : offered.filter((d) => ticked.has(d.kind)).flatMap((d) => d.sheets);

  const { w, h } = PAPER_MM[paper];
  const css = useMemo(() => {
    const hidden = onlyStale
      ? `#pk-pages .pk-page:not([data-stale]) { display: none; }`
      : docs
          .filter((d) => !ticked.has(d.kind) || d.unavailable)
          .map((d) => `#pk-pages [data-doc="${d.kind}"] { display: none; }`)
          .join("\n");
    return `
:root { --pk-w: ${w}mm; --pk-h: ${h}mm; }
@page pk-portrait { size: ${w}mm ${h}mm; margin: 0; }
@page pk-landscape { size: ${h}mm ${w}mm; margin: 0; }
${hidden}`;
  }, [docs, ticked, onlyStale, w, h]);

  const toggle = (kind: DocKind) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const go = (keys: Array<{ key: string; fp: string }>, staleMode: boolean) =>
    startTransition(async () => {
      setError("");
      setOnlyStale(staleMode);
      const res = await recordPrinted(stageId, keys);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStamps((prev) => ({ ...prev, ...res.stamps }));
      // Two frames: the stamps and the selection are on the page before the printer reads it.
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      window.print();
      router.refresh();
    });

  const roundHref = (id: string) => {
    const q = new URLSearchParams({ round: id, docs: [...ticked].join(","), paper });
    return `/print?${q.toString()}`;
  };

  return (
    <>
      <style>{css}</style>
      <div className="no-print pk-controls" style={{ display: "grid", gap: 14, marginBottom: 18, maxWidth: 760 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
          {rounds.length > 1 && (
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              Round
              <select className="input" value={roundId} onChange={(e) => router.push(roundHref(e.target.value))} style={{ minHeight: 40 }}>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 12, alignItems: "center" }}>
            <legend style={{ fontSize: 13, marginBottom: 4 }}>Paper</legend>
            {(["a4", "letter"] as const).map((p) => (
              <label key={p} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
                <input type="radio" name="paper" value={p} checked={paper === p} onChange={() => setPaper(p)} />
                {PAPER_NAME[p]}
              </label>
            ))}
          </fieldset>
        </div>

        {stale.length > 0 && (
          <div role="status" className="card elev-sm" style={{ borderLeft: "3px solid var(--color-accent)", gap: 8 }}>
            <strong style={{ fontSize: 15 }}>
              <Icon name="warning-circle" /> {staleSentence(stale.length)}
            </strong>
            <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
              The groups, a tee time, the tees, a handicap or the round code have changed since these were printed:{" "}
              {stale.slice(0, 12).map((s) => s.label).join(" · ")}
              {stale.length > 12 ? ` and ${stale.length - 12} more` : ""}.
            </p>
            <div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() => go(stale.map((s) => ({ key: s.key, fp: s.fp })), true)}
                style={{ minHeight: 40 }}
              >
                <Icon name="printer" /> Reprint these
              </button>
            </div>
            {error && onlyStale && (
              <p role="alert" style={{ margin: 0, color: "var(--color-danger)", fontSize: 14 }}>
                <Icon name="warning-circle" /> {error}
              </p>
            )}
          </div>
        )}
        {gone.length > 0 && (
          <div className="card elev-sm" style={{ gap: 6 }}>
            <strong style={{ fontSize: 14 }}>Printed sheets that are no longer on the Tee sheet — collect them</strong>
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{gone.slice(0, 12).join(" · ")}</p>
          </div>
        )}

        <fieldset className="card elev-sm" style={{ gap: 2 }}>
          <legend className="card-title" style={{ fontSize: 15 }}>What to print for this round</legend>
          {docs.map((d) => {
            const off = !!d.unavailable || d.sheets.length === 0;
            const outOfDate = d.sheets.filter((s) => s.state === "stale").length;
            const printed = d.sheets.filter((s) => s.state !== "unprinted").length;
            const status = off
              ? d.unavailable
              : outOfDate > 0
                ? `${outOfDate} out of date`
                : printed === d.sheets.length
                  ? `Printed · version ${Math.max(...d.sheets.map((s) => s.printedVersion))}`
                  : printed > 0
                    ? `${printed} of ${d.sheets.length} printed`
                    : "Not printed yet";
            return (
              <label
                key={d.kind}
                style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderTop: "1px solid var(--color-divider)", opacity: off ? 0.6 : 1 }}
              >
                <input
                  type="checkbox"
                  checked={!off && ticked.has(d.kind)}
                  disabled={off}
                  onChange={() => {
                    setOnlyStale(false);
                    toggle(d.kind);
                  }}
                  style={{ marginTop: 3, width: 18, height: 18 }}
                  aria-describedby={`pk-${d.kind}-status`}
                />
                <span style={{ display: "grid", gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>
                    {d.title}
                    {!off && (
                      <span className="text-muted" style={{ fontWeight: 400 }}>
                        {" "}
                        — {d.what} · {d.sheets.length} {d.sheets.length === 1 ? "sheet" : "sheets"}
                      </span>
                    )}
                  </span>
                  <span id={`pk-${d.kind}-status`} className="text-muted" style={{ fontSize: 13 }}>
                    {status}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || chosen.length === 0}
            onClick={() => go(chosen.map((s) => ({ key: s.key, fp: s.fp })), onlyStale)}
            style={{ minHeight: 44 }}
          >
            <Icon name="printer" /> {onlyStale ? "Print the out-of-date sheets" : "Print the ticked sheets"} ({chosen.length})
          </button>
          {onlyStale && (
            <button type="button" className="btn btn-secondary" onClick={() => setOnlyStale(false)} style={{ minHeight: 44 }}>
              Show everything ticked
            </button>
          )}
          <span className="text-muted" style={{ fontSize: 13 }}>
            {PAPER_NAME[paper]}, one sheet per page. In the print dialog choose &ldquo;Actual size&rdquo; (or 100%) and turn headers and footers off.
          </span>
        </div>
        {error && !(onlyStale && stale.length > 0) && (
          <p role="alert" style={{ margin: 0, color: "var(--color-danger)", fontSize: 14 }}>
            <Icon name="warning-circle" /> {error}
          </p>
        )}
      </div>
      <StampContext.Provider value={{ nowWords, printed: stamps }}>{children}</StampContext.Provider>
    </>
  );
}
