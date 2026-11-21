"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerAsGuest, startGuestEntry } from "@/app/actions/guest-entry";
import { GUEST_WORDS } from "@/lib/domain/guest-entry";
import { holdGuestCode } from "@/lib/guest-code-memory";
import { bringIntoView } from "@/lib/bring-into-view";
import { Icon } from "./Icon";

/**
 * "ENTER AS A GUEST" — THE FIRST BLOCK OF THE SIGN-UP PAGE WHEN THE ORGANIZER HAS SWITCHED GUESTS ON (J39/J40 PR 3B;
 * design A3, re-walk N6: one order, the guest button first). A full-width button that opens the form in place.
 * No email and no phone are asked, even where the event requires a phone of members. A member reads past one
 * labelled button and presses nothing extra.
 *
 * The form carries a nonce of 128 bits, made when the form is DRAWN (`crypto.getRandomValues`), so a send that got
 * no answer and is tried again is the same press and returns the same entry, never a second one (C3.5). A failed send
 * says "Couldn't send. Try again." with the name, the figure and the inviter kept.
 */
function newNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // 24 bytes = 192 bits, base64url: 32 characters.
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function GuestEntryForm({ token, clubName }: { token: string; clubName: string }) {
  const W = GUEST_WORDS;
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [handicap, setHandicap] = useState("");
  const [invitedBy, setInvitedBy] = useState("");
  const [error, setError] = useState("");
  const [failedToSend, setFailedToSend] = useState(false);
  const [pending, start] = useTransition();
  const nonce = useRef<string | null>(null);

  const show = () =>
    start(async () => {
      // The device cookie goes on BEFORE the submit (D3), so the form's own request arrives holding one.
      try {
        await startGuestEntry();
      } catch {
        // A phone that refuses cookies is counted in its own bucket; the form still opens.
      }
      nonce.current = newNonce();
      setOpen(true);
    });

  const send = () =>
    start(async () => {
      setError("");
      setFailedToSend(false);
      if (!nonce.current) nonce.current = newNonce();
      try {
        const r = await registerAsGuest(token, { name, handicap, invitedBy }, nonce.current);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        // The code lives in this page's memory only, and goes on with the client-side move to Today.
        holdGuestCode(r.code);
        router.push("/me");
      } catch {
        setError(W.noSend);
        setFailedToSend(true);
      }
    });

  return (
    <section aria-label="Enter as a guest" style={{ marginBottom: 18 }} data-testid="guest-entry">
      {!open ? (
        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ minHeight: 56, fontSize: 16, display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}
          disabled={pending}
          onClick={show}
        >
          <span style={{ fontSize: 14, fontWeight: 400 }}>{W.enterAsGuest(clubName || "this club")}</span>
          <span style={{ fontWeight: 700 }}>
            {W.enterAsGuestButton}: {W.enterAsGuestHint.toLowerCase()}
          </span>
        </button>
      ) : (
        <form
          className="card elev-sm"
          style={{ gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="field">
            <label htmlFor={`${id}-name`} style={{ fontSize: 14, fontWeight: 600 }}>
              {W.nameLabel}
            </label>
            <input id={`${id}-name`} className="input" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} style={{ fontSize: 16, minHeight: 48 }} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-hcp`} style={{ fontSize: 14, fontWeight: 600 }}>
              {W.figureLabel}
            </label>
            <input
              id={`${id}-hcp`}
              className="input"
              inputMode="decimal"
              autoComplete="off"
              maxLength={12}
              value={handicap}
              onChange={(e) => setHandicap(e.target.value)}
              aria-describedby={`${id}-hcp-hint`}
              style={{ fontSize: 16, minHeight: 48 }}
            />
            <p id={`${id}-hcp-hint`} className="text-muted" style={{ fontSize: 14, margin: "4px 0 0" }}>
              {W.figureHint}
            </p>
          </div>
          <div className="field">
            <label htmlFor={`${id}-by`} style={{ fontSize: 14, fontWeight: 600 }}>
              {W.inviterLabel}
            </label>
            <input id={`${id}-by`} className="input" autoComplete="off" maxLength={80} value={invitedBy} onChange={(e) => setInvitedBy(e.target.value)} aria-describedby={`${id}-by-hint`} style={{ fontSize: 16, minHeight: 48 }} />
            <p id={`${id}-by-hint`} className="text-muted" style={{ fontSize: 14, margin: "4px 0 0" }}>
              {W.inviterHint}
            </p>
          </div>
          {error && (
            <p role="alert" ref={bringIntoView} className="form-error" style={{ fontSize: 14, margin: 0 }}>
              <Icon name="warning-circle" /> {error}
            </p>
          )}
          <button type={failedToSend ? "button" : "submit"} className="btn btn-primary btn-block" style={{ minHeight: 52, fontSize: 16 }} disabled={pending} onClick={failedToSend ? send : undefined}>
            {failedToSend ? W.tryAgain : W.askToPlay}
          </button>
        </form>
      )}
    </section>
  );
}
