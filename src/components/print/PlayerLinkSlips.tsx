"use client";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../Icon";
import { ConfirmButton } from "../ConfirmButton";
import { qrModules, qrPath, type QrEncoder } from "@/lib/qr";
import { groupedCode, linkAddress, playerLinkUrl } from "@/lib/domain/player-link";
import { SLIP_MM, SLIP_WORDS, slipPages } from "@/lib/domain/player-link-slips";
import { PAPER_MM, type PaperSize } from "@/lib/domain/print-kit";
import { newPlayerLinksFor, printPlayerLinkSlips } from "@/app/actions/player-link-slips";

/**
 * PLAYER LINK SLIPS on the Print kit (J39/J40 PR 3; design §3.1, A10 to A12).
 *
 * THE PAGE NEVER HOLDS A CODE (S7). The server renders this card with counts
 * only; a press asks `printPlayerLinkSlips`, and the answer is held in THIS
 * component's state, drawn as slips (QR made here, from the local
 * `qrcode-generator`), printed, and dropped on `afterprint`, on Done and on
 * leaving the page. Nothing goes to storage, the print log or the service worker.
 *
 * The sheet is drawn into `document.body` (a portal) and, while it is there,
 * the body is marked `data-printing="links"`, so the printer gets the slips and
 * nothing else of the page: eight to a sheet, on the club's own paper.
 */
export interface SlipCardSummary {
  all: number;
  fresh: number;
  printedAny: boolean;
  printedIds: string[];
}

type Sheet = { eventName: string; slips: Array<{ name: string; code: string }> };

export function PlayerLinkSlips({ summary, paper }: { summary: SlipCardSummary; paper: PaperSize }) {
  const W = SLIP_WORDS;
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [encode, setEncode] = useState<QrEncoder | null>(null);
  const [origin, setOrigin] = useState("");
  const [said, setSaid] = useState("");
  const [error, setError] = useState("");
  const [renewed, setRenewed] = useState(false);
  const [pending, start] = useTransition();

  // Read after mounting, so the first paint is the same on the server and here (hydration #418).
  useEffect(() => setOrigin(window.location.origin), []);

  // The encoder only once a sheet is asked for: a visit that prints nothing loads none of it.
  useEffect(() => {
    if (!sheet || encode) return;
    import("qrcode-generator")
      .then((m) => setEncode(() => m.default as unknown as QrEncoder))
      .catch(() => setError("The QR codes could not be drawn. Check your connection and try again."));
  }, [sheet, encode]);

  // While a sheet is out: the body says so (the print rule below), and after printing it is dropped.
  useEffect(() => {
    if (!sheet) return;
    document.body.dataset.printing = "links";
    const drop = () => setSheet(null);
    window.addEventListener("afterprint", drop);
    return () => {
      window.removeEventListener("afterprint", drop);
      delete document.body.dataset.printing;
    };
  }, [sheet]);

  // The printer is asked once the QR codes are on the sheet.
  useEffect(() => {
    if (!sheet || !encode || !origin || sheet.slips.length === 0) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    return () => cancelAnimationFrame(id);
  }, [sheet, encode, origin]);

  const print = (onlyNew: boolean) =>
    start(async () => {
      setError("");
      setSaid("");
      const r = await printPlayerLinkSlips(onlyNew);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.skipped) setSaid(r.skipped);
      if (r.slips.length === 0) {
        setSaid([r.skipped, W.nothingNew].filter(Boolean).join(" "));
        return;
      }
      setRenewed(false);
      setSheet({ eventName: r.eventName, slips: r.slips });
      router.refresh();
    });

  const renew = () =>
    start(async () => {
      setError("");
      const r = await newPlayerLinksFor(summary.printedIds);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaid(W.newForAllDone(r.made));
      setRenewed(true);
      router.refresh();
    });

  const { w, h } = PAPER_MM[paper];
  const address = linkAddress(origin);
  const busy = pending || !!sheet;

  return (
    <section className="card elev-sm no-print" aria-labelledby="link-slips-title" data-testid="link-slips" style={{ gap: 10, maxWidth: 760, marginBottom: 16 }}>
      <div>
        <h2 id="link-slips-title" style={{ fontSize: 16, margin: 0 }}>
          {W.title}
        </h2>
        <p className="text-muted" style={{ fontSize: 14, lineHeight: 1.55, margin: "4px 0 0" }}>{summary.all > 0 ? W.lead : W.none}</p>
      </div>

      {summary.all > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {renewed ? (
            <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || summary.fresh === 0} onClick={() => print(true)}>
              <Icon name="printer" /> {W.printNew}
            </button>
          ) : summary.printedAny ? (
            <>
              <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || summary.fresh === 0} onClick={() => print(true)}>
                <Icon name="printer" /> {W.onlyNew(summary.fresh)}
              </button>
              <button type="button" className="btn btn-secondary" style={{ minHeight: 48 }} disabled={busy} onClick={() => print(false)}>
                {W.allSlips(summary.all)}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => print(false)}>
              <Icon name="printer" /> {W.printAll(summary.all)}
            </button>
          )}
          {!renewed && summary.printedIds.length > 0 && (
            <ConfirmButton
              icon="arrows-clockwise"
              label={W.newForAll(summary.printedIds.length)}
              title={W.newForAll(summary.printedIds.length)}
              confirmLabel={W.newForAll(summary.printedIds.length)}
              note={W.newForAllConfirm(summary.printedIds.length)}
              className="btn btn-secondary"
              disabled={busy}
              onConfirm={renew}
            />
          )}
        </div>
      )}

      {pending && !sheet && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{W.printing}</p>}
      {said && (
        <p role="status" style={{ fontSize: 14, margin: 0 }}>
          <Icon name="check" /> {said}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error" style={{ margin: 0 }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}

      {sheet &&
        createPortal(
          <div className="link-slips-sheet" data-testid="link-slips-sheet">
            <style>{`
@page link-slips { size: ${w}mm ${h}mm; margin: 10mm; }
.link-slips-sheet { position: fixed; inset: 0; z-index: 1000; overflow: auto; background: #fff; color: #000; padding: 16px; }
.link-slips-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.link-slip { box-sizing: border-box; display: flex; justify-content: space-between; align-items: center; gap: 3mm; padding: 4mm; border: 0.3mm dashed #000; overflow: hidden; break-inside: avoid; }
@media print {
  body[data-printing="links"] > *:not(.link-slips-sheet) { display: none !important; }
  body[data-printing="links"] .link-slips-sheet { position: static !important; background: #fff !important; overflow: visible !important; padding: 0 !important; }
  body[data-printing="links"] .link-slips-bar { display: none !important; }
}`}</style>
            <div className="link-slips-bar">
              <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} onClick={() => window.print()}>
                <Icon name="printer" /> {W.printAgain}
              </button>
              <button type="button" className="btn btn-secondary" style={{ minHeight: 48 }} onClick={() => setSheet(null)}>
                {W.done}
              </button>
            </div>
            {slipPages(sheet.slips).map((page, p) => (
              <div key={p} className="link-slips-page" style={{ page: "link-slips", breakAfter: "page", display: "grid", gridTemplateColumns: `repeat(2, ${SLIP_MM.w}mm)`, gridAutoRows: `${SLIP_MM.h}mm` }}>
                {page.map((s) => {
                  const link = origin ? playerLinkUrl(origin, s.code) : "";
                  const drawn = encode && link ? qrPath(qrModules(encode, link), 4) : null;
                  return (
                    <div key={s.code} data-testid="link-slip" className="link-slip">
                      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "1.5mm" }}>
                        <strong data-testid="link-slip-name" style={{ fontSize: "16pt", lineHeight: 1.1, overflowWrap: "anywhere" }}>
                          {s.name}
                        </strong>
                        <span style={{ fontSize: "9pt" }}>{sheet.eventName}</span>
                        <span style={{ fontSize: "8.5pt", lineHeight: 1.3 }}>{W.scan}</span>
                        <span style={{ fontSize: "8.5pt" }}>{W.typeAt(address)}</span>
                        <strong data-testid="link-slip-code" style={{ fontSize: "15pt", letterSpacing: "0.06em", fontVariantNumeric: "tabular-nums" }}>
                          {groupedCode(s.code)}
                        </strong>
                        <span style={{ fontSize: "8.5pt", fontWeight: 600 }}>{W.keep}</span>
                      </div>
                      {drawn && (
                        <svg viewBox={`0 0 ${drawn.size} ${drawn.size}`} role="img" aria-label={`QR code for ${s.name}'s player link`} style={{ width: "34mm", height: "34mm" }}>
                          <rect width={drawn.size} height={drawn.size} fill="#fff" />
                          <path d={drawn.d} fill="#000" />
                        </svg>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </section>
  );
}
