"use client";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { setAccountsOpen } from "@/app/actions/owner";
import { LAUNCH_SURFACES, NOT_SWITCHED, OWNER_CARD, type LaunchState } from "@/lib/go-live";
import type { HoldRule } from "@/lib/sign-in-gate";

/**
 * THE GO-LIVE SWITCH, on the owner console (Ajay, 2026-10-21: "make sure its an easy control which
 * we can flip back to allow signup / signin"; 2026-10-23: "I just need one switch to say let's go
 * live and that should change coming soon or any blockades to online").
 *
 * Before the press it says what the press will do — the list is `LAUNCH_SURFACES`, the same list
 * every held page is wired from and the browser sweep walks, never a copy written here — and the
 * press asks once more in a dialog that names the effect. After it: when it went live, and the one
 * press that holds it all again.
 *
 * `switchSays` is the SWITCH's own position (the row), and `rule` whether this deployment lets it
 * decide. They are shown apart, because on a preview or in dev nothing is held whatever the switch
 * says, and `SIGNINS=open` in Vercel opens it whatever the switch says — and the card says so rather
 * than hiding the switch, which is also what lets a browser test press it where the app is never held.
 */
export function OwnerAccounts({ switchSays, liveSince, rule }: { switchSays: LaunchState; liveSince: string; rule: HoldRule }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState("");
  const held = switchSays === "held";

  const flip = () =>
    start(async () => {
      const res = await setAccountsOpen(held);
      setAsking(false);
      setSaid(res.ok ? (res.now === "open" ? OWNER_CARD.wentLive : OWNER_CARD.heldAgain) : res.error ?? "That did not save.");
      router.refresh();
    });

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }} id="accounts">
      <span className="card-title" style={{ fontSize: 15 }}>{OWNER_CARD.title}</span>
      <p style={{ fontSize: 14, margin: "6px 0 4px" }}>{held ? OWNER_CARD.held : OWNER_CARD.live(liveSince)}</p>
      {OWNER_CARD.rule[rule] && (
        <p className="text-muted" style={{ fontSize: 13, margin: "0 0 4px" }}>
          {OWNER_CARD.rule[rule]}
        </p>
      )}

      <p style={{ fontSize: 13.5, fontWeight: 600, margin: "10px 0 4px" }}>{held ? OWNER_CARD.willGoLive : OWNER_CARD.willHold}</p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
        {LAUNCH_SURFACES.map((s) => (
          <li key={s.id}>
            <span style={{ fontWeight: 500 }}>{s.where}</span>: {held ? s.live : s.held}
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          className={held ? "btn btn-primary" : "btn btn-secondary"}
          disabled={pending}
          onClick={() => setAsking(true)}
        >
          <Icon name={held ? "lock-key-open" : "lock"} /> {held ? OWNER_CARD.goLive : OWNER_CARD.holdAgain}
        </button>
      </div>
      {said && (
        <p role="status" style={{ fontSize: 13, margin: "8px 0 0" }}>
          {said}
        </p>
      )}

      <details style={{ marginTop: 10, fontSize: 13 }}>
        <summary style={{ cursor: "pointer", minHeight: 32 }}>{OWNER_CARD.notSwitched}</summary>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          {NOT_SWITCHED.map((n) => (
            <li key={n.id}>
              <span style={{ fontWeight: 500 }}>{n.what}</span> — {n.why}
            </li>
          ))}
        </ul>
      </details>

      {/* ASKED ONCE MORE, IN A DIALOG THAT SAYS WHAT HAPPENS — portalled to the page as the player
          app's sign-out is, so nothing in the console's layout can become its containing block. */}
      {asking &&
        createPortal(
          <div className="dialog-backdrop" onClick={() => !pending && setAsking(false)}>
            <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="golive-dialog-title" onClick={(e) => e.stopPropagation()}>
              <div className="dialog-title" id="golive-dialog-title">
                {held ? OWNER_CARD.goLiveTitle : OWNER_CARD.holdTitle}
              </div>
              <div className="dialog-body">{held ? OWNER_CARD.goLiveNote(LAUNCH_SURFACES.length) : OWNER_CARD.holdNote}</div>
              <div className="dialog-actions">
                <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setAsking(false)}>
                  {held ? OWNER_CARD.keepHeld : OWNER_CARD.keepLive}
                </button>
                <button type="button" className="btn btn-primary" disabled={pending} onClick={flip}>
                  {held ? OWNER_CARD.goLiveConfirm : OWNER_CARD.holdConfirm}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
