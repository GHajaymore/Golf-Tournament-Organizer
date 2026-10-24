"use client";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { formatAccessCode, roundCodeLink } from "@/lib/code-format";
import { qrModules, qrPath, type QrEncoder } from "@/lib/qr";

export interface SignRound {
  stageId: string;
  label: string;
  code: string;
}

/**
 * A PRINTED SIGN FOR EACH ROUND'S CODE (2026-10-17).
 *
 * Borrowed from how charity days are run elsewhere, and settled by the review
 * panel: ONE sign per round, not per group — the code already leads each
 * player to their own match, and eighteen different slips are eighteen ways
 * to put the wrong one in a cart. No player's name is printed: a sign is
 * photographed and left in carts, and a name on it is wrong the moment a
 * group changes. The QR opens `/play#CODE` (`roundCodeLink`), which goes
 * straight to the round's names; the code is printed large beside it for a
 * phone that will not scan in the sun.
 *
 * Drawn as paper, black on white, for the reason the scorecards are: the
 * question is what comes out of the printer.
 */
export function RoundSigns({ eventName, rounds, shareToken }: { eventName: string; rounds: SignRound[]; shareToken?: string }) {
  const withCodes = rounds.filter((r) => r.code);
  const [open, setOpen] = useState(false);
  const [encode, setEncode] = useState<QrEncoder | null>(null);
  const [origin, setOrigin] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || encode) return;
    setOrigin(window.location.origin);
    // Loaded when the signs are opened, so no screen's first download carries it.
    import("qrcode-generator")
      .then((m) => setEncode(() => m.default as unknown as QrEncoder))
      .catch(() => setFailed(true));
  }, [open, encode]);

  if (withCodes.length === 0) return null;
  const host = origin.replace(/^https?:\/\//, "");

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 13, minHeight: "var(--tap-min, 36px)" }}
          aria-expanded={open}
          aria-controls="round-signs"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="qr-code" /> {open ? "Hide the signs" : withCodes.length === 1 ? "Show the sign" : "Show the signs"}
        </button>
        {open && encode && (
          <button type="button" className="btn btn-primary" style={{ fontSize: 13, minHeight: "var(--tap-min, 36px)" }} onClick={() => window.print()}>
            <Icon name="printer" /> {withCodes.length === 1 ? "Print the sign" : `Print ${withCodes.length} signs`}
          </button>
        )}
      </div>

      {open && (
        <>
          <p className="text-muted" style={{ fontSize: 13, margin: "8px 0" }}>
            One sign per round, a page each: one in every cart and one on the first tee. Scan it with your own phone
            first — it should open this round&apos;s names. Stop there; tapping a name starts scoring as that player.
          </p>
          {failed && (
            <p style={{ fontSize: 13, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> The signs could not be drawn. Check your connection and open them again.
            </p>
          )}
          <style>{`
            .round-sign {
              background: #fff; color: #000; border-radius: 10px; padding: 28px 20px;
              margin-bottom: 12px; text-align: center; display: flex; flex-direction: column;
              align-items: center; gap: 10px;
            }
            .round-sign .rs-event { font-size: 15px; font-weight: 600; }
            .round-sign .rs-round { font-size: 22px; font-weight: 700; line-height: 1.25; text-wrap: balance; }
            .round-sign svg { width: min(70mm, 72vw); height: auto; display: block; }
            .round-sign .rs-scan { font-size: 18px; font-weight: 600; }
            .round-sign .rs-code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 40px; font-weight: 700; letter-spacing: 0.08em; }
            .round-sign .rs-small { font-size: 13px; line-height: 1.5; max-width: 46ch; }
            @media print {
              body * { visibility: hidden; }
              #round-signs, #round-signs * { visibility: visible; }
              #round-signs { position: absolute; left: 0; top: 0; width: 100%; }
              .round-sign { page-break-after: always; break-after: page; border-radius: 0; margin: 0; padding-top: 18mm; }
              .round-sign .rs-round { font-size: 26pt; }
              .round-sign .rs-code { font-size: 44pt; }
            }
          `}</style>
          <div id="round-signs">
            {encode &&
              origin &&
              withCodes.map((r) => {
                const link = roundCodeLink(origin, r.code);
                const { d, size } = qrPath(qrModules(encode, link));
                return (
                  <section key={r.stageId} className="round-sign" aria-label={`Sign for ${r.label}`} data-link={link}>
                    <div className="rs-event">{eventName}</div>
                    <div className="rs-round">{r.label}</div>
                    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`QR code for ${r.label}`} shapeRendering="crispEdges">
                      <rect width={size} height={size} fill="#fff" />
                      <path d={d} fill="#000" />
                    </svg>
                    <div className="rs-scan">Scan to enter your score</div>
                    <div className="rs-code">{formatAccessCode(r.code)}</div>
                    <div className="rs-small">
                      Then tap your own name. No camera? Go to <b>{host}/play</b> and type the code.
                      {shareToken ? (
                        <>
                          <br />
                          Leaderboard: {host}/live/{shareToken}
                        </>
                      ) : null}
                    </div>
                  </section>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}
