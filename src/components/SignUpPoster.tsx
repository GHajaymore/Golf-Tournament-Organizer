"use client";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { qrModules, qrPath, type QrEncoder } from "@/lib/qr";
import { QrLogoMark } from "./QrLogoMark";
import { showRegistrationCode } from "@/app/actions/tournament";
import { GUEST_WORDS } from "@/lib/domain/guest-entry";

/**
 * "SCAN TO SIGN UP" — A POSTER FOR THE TOURNAMENT'S SIGN-UP LINK (2026-10-17).
 *
 * How members find a club competition is still the noticeboard and the pro
 * shop counter, so the public sign-up link gets what the round codes got: a
 * QR code, and a page that prints. The review panel's one condition was that
 * it add nothing to "Invite players", whose row already holds five buttons,
 * so it lives with the link it prints, under Copy link.
 *
 * The QR is drawn as `RoundSigns` draws it (`qr.ts`, the encoder loaded only
 * when the poster is opened). Black on white, for the printer.
 */
export function SignUpPoster({
  url,
  name,
  when,
  where,
  guests = false,
  closeWarning = "",
}: {
  url: string;
  name: string;
  when: string;
  where: string;
  /** Guest entry is switched on: the poster says guests need no email. */
  guests?: boolean;
  /** Entries close before the event's first day: said before the poster is printed (A2b); "" for none. */
  closeWarning?: string;
}) {
  const [open, setOpen] = useState(false);
  // The short, typed form of the link, printed under the QR. Made by this press if there is none (lazy, C1.4).
  const [code, setCode] = useState<string | null>(null);
  const [encode, setEncode] = useState<QrEncoder | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || encode) return;
    import("qrcode-generator")
      .then((m) => setEncode(() => m.default as unknown as QrEncoder))
      .catch(() => setFailed(true));
  }, [open, encode]);

  useEffect(() => {
    if (!open || code) return;
    showRegistrationCode()
      .then((r) => setCode(r.ok && r.code ? r.code : null))
      .catch(() => setCode(null));
  }, [open, code]);

  const short = url.replace(/^https?:\/\//, "");
  const host = short.split("/")[0];
  const drawn = encode ? qrPath(qrModules(encode, url, { logo: true }), 4, { logo: true }) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary"
          aria-expanded={open}
          aria-controls="signup-poster"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="qr-code" /> {open ? "Hide QR code" : "Show QR code"}
        </button>
        {open && drawn && (
          <button type="button" className="btn btn-primary" data-reads="" onClick={() => window.print()}>
            <Icon name="printer" /> Print poster
          </button>
        )}
      </div>
      {open && closeWarning && (
        <p style={{ fontSize: 14, margin: 0 }} data-testid="poster-warning">
          <Icon name="warning-circle" /> {closeWarning}
        </p>
      )}
      {open && failed && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> The QR code could not be drawn. Check your connection and open it again.
        </p>
      )}
      {open && (
        <>
          <style>{`
            .signup-poster {
              background: #fff; color: #000; border-radius: 10px; padding: 28px 20px; text-align: center;
              display: flex; flex-direction: column; align-items: center; gap: 10px;
            }
            .signup-poster .sp-name { font-size: 24px; font-weight: 700; line-height: 1.2; text-wrap: balance; }
            .signup-poster .sp-line { font-size: 15px; }
            .signup-poster svg { width: min(80mm, 72vw); height: auto; display: block; }
            .signup-poster .sp-link { display: block; color: inherit; text-decoration: none; }
            .signup-poster .sp-scan { font-size: 22px; font-weight: 700; }
            .signup-poster .sp-url { font-size: 13px; overflow-wrap: anywhere; max-width: 60ch; }
            @media print {
              body * { visibility: hidden; }
              #signup-poster, #signup-poster * { visibility: visible; }
              #signup-poster { position: absolute; left: 0; top: 0; width: 100%; }
              .signup-poster { border-radius: 0; padding-top: 20mm; }
              .signup-poster .sp-name { font-size: 30pt; }
              .signup-poster .sp-scan { font-size: 26pt; }
            }
          `}</style>
          <div id="signup-poster">
            {drawn && (
              <section className="signup-poster" aria-label={`Sign-up poster for ${name}`} data-link={url}>
                <div className="sp-name">{name}</div>
                {(when || where) && <div className="sp-line">{[when, where].filter(Boolean).join(" · ")}</div>}
                {/* Tappable (2026-11-05): the code is a link to its own address, so a phone showing the
                    poster can open what a camera would. On paper it is only ink. */}
                <a href={url} target="_blank" rel="noopener noreferrer" className="sp-link" aria-label={`Open the sign-up link of ${name}`}>
                  <svg viewBox={`0 0 ${drawn.size} ${drawn.size}`} role="img" aria-label={`QR code for the sign-up link of ${name}`} shapeRendering="crispEdges">
                    <rect width={drawn.size} height={drawn.size} fill="#fff" />
                    <path d={drawn.d} fill="#000" />
                    {drawn.logo && <QrLogoMark logo={drawn.logo} />}
                  </svg>
                </a>
                <div className="sp-scan">Scan to sign up</div>
                {guests && <div className="sp-line">{GUEST_WORDS.posterGuests}</div>}
                <div className="sp-url">No camera? Go to {short}</div>
                {code && (
                  <div className="sp-url" data-testid="poster-code">
                    Or go to {host}/register and type <strong style={{ fontSize: 22, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{code}</strong>
                  </div>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
