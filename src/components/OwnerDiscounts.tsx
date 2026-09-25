"use client";
import { useState, useTransition } from "react";
import { createDiscountCode, setDiscountCodeActive } from "@/app/actions/owner";
import { Icon } from "./Icon";

/**
 * THE OWNER'S DISCOUNT CODES — generate a percentage-off code and hand it out.
 *
 * The owner sets the percent (and, optionally, a label, a redemption cap and an
 * expiry) and presses Generate; the code is created and shown to copy. The list
 * below is every code and how it is doing, with a switch to turn one off.
 *
 * Redemption at a paid upgrade is a later step — there is no billing flow yet —
 * so this generates and manages codes; it does not itself charge anyone.
 */
export function OwnerDiscounts({
  codes,
}: {
  codes: {
    code: string;
    percentOff: number;
    label: string;
    active: boolean;
    uses: string;
    expires: string;
  }[];
}) {
  const [percent, setPercent] = useState("20");
  const [label, setLabel] = useState("");
  const [max, setMax] = useState("");
  const [expires, setExpires] = useState("");
  const [made, setMade] = useState<{ code: string; percentOff: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const generate = () => {
    setError("");
    setMade(null);
    setCopied(false);
    const p = Math.round(Number(percent));
    if (!Number.isInteger(p) || p < 1 || p > 100) {
      setError("Enter a whole percent from 1 to 100.");
      return;
    }
    start(async () => {
      const res = await createDiscountCode({
        percentOff: p,
        label: label.trim(),
        maxRedemptions: max.trim() === "" ? null : Number(max),
        expiresAt: expires || null,
      });
      if (!res.ok || !res.code) setError(res.error ?? "Couldn't create the code.");
      else {
        setMade({ code: res.code, percentOff: res.percentOff ?? p });
        setLabel("");
        setMax("");
        setExpires("");
      }
    });
  };

  const copy = (code: string) => {
    try {
      void navigator.clipboard?.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable; the code is on screen to copy by hand.
    }
  };

  const toggle = (code: string, active: boolean) => {
    start(async () => {
      await setDiscountCodeActive(code, active);
    });
  };

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span className="card-title" style={{ fontSize: 15 }}>Discount codes</span>
        <span className="text-muted" style={{ fontSize: 11.5 }}>Generate a %-off code to give a club.</span>
      </div>

      <p className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: "8px 0 0" }}>
        Set the percentage and press <strong>Generate</strong>. A code is created for you to copy and send.
        A <strong>label</strong> is your own note; a <strong>limit</strong> and an <strong>expiry</strong> are
        optional. Redemption is applied at a paid upgrade, which is coming with billing — codes made now are kept.
      </p>

      {/* Generate form */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
          <label htmlFor="disc-pct" style={{ fontSize: 12, fontWeight: 600 }}>Percent off</label>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input
              id="disc-pct"
              className="input"
              inputMode="numeric"
              value={percent}
              onChange={(e) => setPercent(e.target.value.replace(/[^0-9]/g, ""))}
              style={{ width: 64, fontVariantNumeric: "tabular-nums" }}
              aria-label="Percent off"
            />
            <span className="text-muted" style={{ fontSize: 14 }}>%</span>
          </span>
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 160 }}>
          <label htmlFor="disc-label" style={{ fontSize: 12, fontWeight: 600 }}>Label <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span></label>
          <input
            id="disc-label"
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Launch — first 20 clubs"
            maxLength={80}
          />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
          <label htmlFor="disc-max" style={{ fontSize: 12, fontWeight: 600 }}>Limit</label>
          <input
            id="disc-max"
            className="input"
            inputMode="numeric"
            value={max}
            onChange={(e) => setMax(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="∞"
            style={{ width: 64, fontVariantNumeric: "tabular-nums" }}
            aria-label="Redemption limit (blank for no limit)"
          />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
          <label htmlFor="disc-exp" style={{ fontSize: 12, fontWeight: 600 }}>Expires</label>
          <input
            id="disc-exp"
            className="input"
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            aria-label="Expiry date (optional)"
          />
        </span>
        <button type="button" className="btn btn-primary touch-target" onClick={generate} disabled={pending}>
          {pending ? "Working…" : "Generate"}
        </button>
      </div>

      {made && (
        <div
          style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "var(--color-surface-2)" }}
        >
          <span className="text-muted" style={{ fontSize: 12.5 }}>New code — {made.percentOff}% off:</span>
          <code style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 18, fontWeight: 700, letterSpacing: "0.06em" }}>
            {made.code}
          </code>
          <button type="button" className="btn btn-ghost touch-target" onClick={() => copy(made.code)}>
            {copied ? (
              <>
                <Icon name="check-circle" /> Copied
              </>
            ) : (
              "Copy"
            )}
          </button>
        </div>
      )}
      {error && (
        <div style={{ marginTop: 10 }}>
          <span className="form-error" style={{ margin: 0 }}>
            <Icon name="warning-circle" /> {error}
          </span>
        </div>
      )}

      {/* Existing codes */}
      <div className="table-scroll" style={{ marginTop: 14 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th style={{ textAlign: "right" }}>Off</th>
              <th>Label</th>
              <th style={{ textAlign: "right" }}>Used</th>
              <th>Expires</th>
              <th style={{ textAlign: "right" }}></th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.code} style={{ opacity: c.active ? 1 : 0.55 }}>
                <td style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600, letterSpacing: "0.04em" }}>{c.code}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.percentOff}%</td>
                <td className="text-muted">{c.label || "—"}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.uses}</td>
                <td className="text-muted">{c.expires || "—"}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="btn btn-ghost touch-target"
                    onClick={() => toggle(c.code, !c.active)}
                    disabled={pending}
                    style={{ fontSize: 12.5 }}
                  >
                    {c.active ? "Turn off" : "Turn on"}
                  </button>
                </td>
              </tr>
            ))}
            {codes.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted" style={{ fontSize: 13, padding: 16 }}>
                  No codes yet — generate one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
