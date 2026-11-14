"use client";
import { useEffect, useState, useTransition } from "react";
import { Icon } from "./Icon";
import { ConfirmButton } from "./ConfirmButton";
import { qrModules, qrPath, type QrEncoder } from "@/lib/qr";
import { PLAYER_LINK_WORDS, groupedCode, linkAddress, playerLinkShareMessage, playerLinkUrl, spokenCode } from "@/lib/domain/player-link";
import { muteGuestInMessages, newPlayerLink, playerLinkStatus, showPlayerLink, turnOffPlayerLink } from "@/app/actions/player-link";

/**
 * THE PLAYER LINK PANEL (J39/J40 PR 1; design §4.1) — on a guest's row on
 * Entries, for the tournament's staff.
 *
 * The code is in NO rendered page (S7): it arrives only as the answer to one of
 * these presses (a server action), is held in this panel's state while it is
 * open, and each hand-over is on the record (never the code). Show QR, Read it
 * out, Copy and Share all hand over THE SAME link (D3); only New link, with a
 * confirm, makes another. TourneyHQ sends nothing: Share opens the organizer's
 * own phone's share sheet and they press Send there (§4.1).
 */
export function PlayerLinkPanel({ playerId, name, eventName }: { playerId: string; name: string; eventName: string }) {
  const W = PLAYER_LINK_WORDS;
  const [status, setStatus] = useState<{ text: string; made: boolean; revoked: boolean; suggestNew: boolean; muted: boolean } | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [view, setView] = useState<"qr" | "read" | null>(null);
  const [said, setSaid] = useState("");
  const [error, setError] = useState("");
  const [encode, setEncode] = useState<QrEncoder | null>(null);
  const [pending, start] = useTransition();

  const loadStatus = () =>
    playerLinkStatus(playerId).then((r) => {
      if (r.ok) setStatus({ text: r.status, made: r.made, revoked: r.revoked, suggestNew: r.suggestNew, muted: r.muted });
      else setError(r.error);
    });

  useEffect(() => {
    void loadStatus();
    // Once, for this player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  useEffect(() => {
    if (view !== "qr" || encode) return;
    import("qrcode-generator")
      .then((m) => setEncode(() => m.default as unknown as QrEncoder))
      .catch(() => setError("The QR code could not be drawn. Check your connection and try again."));
  }, [view, encode]);

  // Read after mounting, so the first paint is the same on the server and here (hydration #418).
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator.share === "function");
  }, []);
  const link = code ? playerLinkUrl(origin, code) : "";
  const address = linkAddress(origin);

  /** The code for one hand-over, asked of the server each time so each press is on the record. */
  const handOver = (how: "shown" | "read" | "copied" | "shared", then: (code: string) => void | Promise<void>) =>
    start(async () => {
      setError("");
      setSaid("");
      const r = await showPlayerLink(playerId, how);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCode(r.code);
      await then(r.code);
      await loadStatus();
    });

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSaid(done);
    } catch {
      setError("Couldn't copy here. Use Show QR or Read it out instead.");
    }
  };

  const share = async (c: string) => {
    const text = playerLinkShareMessage({ name, eventName, link: playerLinkUrl(origin, c), address, code: c });
    if (canShare) {
      try {
        await navigator.share({ title: W.panelTitle, text });
      } catch {
        // Closed without sending.
      }
      return;
    }
    await copy(text, "Message copied. Paste it into your own message to them.");
  };

  const drawn = view === "qr" && encode && link ? qrPath(qrModules(encode, link), 4) : null;
  const busy = pending || !status;

  return (
    <div className="card" data-player-link={playerId} style={{ gap: 10, padding: 14 }}>
      <div>
        <strong style={{ fontSize: 14 }}>
          {W.panelTitle}: {name}
        </strong>
        <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>{W.panelLead}</p>
        <p role="status" data-testid="player-link-status" style={{ fontSize: 13, margin: "6px 0 0" }}>
          {status?.text ?? "Checking…"}
        </p>
        {status?.suggestNew && (
          <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
            <Icon name="info" /> {W.suggestNew}
          </p>
        )}
      </div>

      {!status?.revoked && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => handOver("shown", () => setView("qr"))}>
            <Icon name="qr-code" /> {W.showQr}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => handOver("read", () => setView("read"))}>
            <Icon name="chat-text" /> {W.readOut}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => handOver("shared", share)}>
            <Icon name="share-network" /> {canShare ? W.share : W.copyMessage}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => handOver("copied", (c) => copy(playerLinkUrl(origin, c), "Link copied."))}>
            <Icon name="link" /> {W.copyLink}
          </button>
        </div>
      )}
      {!status?.revoked && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{W.sendToOne(name)}</p>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {status?.made && (
          <ConfirmButton
            icon="arrows-clockwise"
            label={W.newLink}
            title={W.newLink}
            confirmLabel={W.newLink}
            note={W.newLinkConfirm}
            className="btn btn-secondary"
            disabled={busy}
            onConfirm={() =>
              start(async () => {
                setError("");
                const r = await newPlayerLink(playerId);
                if (!r.ok) {
                  setError(r.error);
                  return;
                }
                setCode(r.code);
                setView("qr");
                setSaid("A new link is made. The old one no longer opens.");
                await loadStatus();
              })
            }
          />
        )}
        {status?.made && !status.revoked && (
          <ConfirmButton
            icon="eye-slash"
            label={W.turnOff}
            title={W.turnOff}
            confirmLabel={W.turnOff}
            note={W.turnOffConfirm}
            className="btn btn-secondary"
            disabled={busy}
            onConfirm={() =>
              start(async () => {
                setError("");
                const r = await turnOffPlayerLink(playerId);
                if (!r.ok) setError(r.error ?? "Couldn't turn it off.");
                setCode(null);
                setView(null);
                await loadStatus();
              })
            }
          />
        )}
        {/* S8 (J39/J40 PR 2): quieten a guest's posts without ending the link. The desk stays open. */}
        {status?.made && !status.revoked && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            aria-pressed={status.muted}
            onClick={() =>
              start(async () => {
                setError("");
                const r = await muteGuestInMessages(playerId, !status.muted);
                if (!r.ok) setError(r.error ?? "Couldn't change that.");
                else setSaid(status.muted ? W.unmutedSaid(name) : W.mutedSaid(name));
                await loadStatus();
              })
            }
          >
            <Icon name={status.muted ? "chat-circle-dots" : "microphone-slash"} /> {status.muted ? W.unmute : W.mute}
          </button>
        )}
      </div>

      {said && (
        <p role="status" style={{ fontSize: 13, margin: 0 }}>
          <Icon name="check" /> {said}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error" style={{ margin: 0 }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}

      {code && view === "qr" && (
        <div
          data-testid="player-link-qr"
          style={{ background: "#fff", color: "#000", borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}
        >
          {drawn && (
            <svg viewBox={`0 0 ${drawn.size} ${drawn.size}`} role="img" aria-label={`QR code for ${name}'s player link`} style={{ width: "min(64mm, 64vw)", height: "auto" }}>
              <rect width={drawn.size} height={drawn.size} fill="#fff" />
              <path d={drawn.d} fill="#000" />
            </svg>
          )}
          {/* Every QR carries its short address and code beneath it (7N's accessibility ruling). */}
          <span style={{ fontSize: 15 }}>
            {address} · code <strong data-testid="player-link-code">{groupedCode(code)}</strong>
          </span>
          <span style={{ fontSize: 13 }}>Keep it to yourself.</span>
        </div>
      )}
      {code && view === "read" && (
        <p data-testid="player-link-spoken" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "0.04em", margin: 0, fontVariantNumeric: "tabular-nums" }}>
          {spokenCode(code)}
        </p>
      )}
    </div>
  );
}
