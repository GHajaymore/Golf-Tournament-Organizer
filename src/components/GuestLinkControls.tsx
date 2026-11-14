"use client";
import { useState, useTransition } from "react";
import { Icon } from "./Icon";
import { PLAYER_LINK_WORDS } from "@/lib/domain/player-link";
import { choosePlayerView, forgetThisPhone } from "@/app/actions/player-link";

/**
 * A GUEST'S OWN TWO CONTROLS in the player shell (J39/J40 PR 1).
 *
 * "Forget me on this phone" takes the place of Sign out for a guest: there is
 * no account to leave. It clears the link from THIS browser and revokes
 * nothing — the slip in their pocket still opens it. Confirmed first, as Sign
 * out is, because a tap by feel on a phone passed round a fourball is easy.
 * It also stops the guest's notices on THIS phone (review of #1133, SEC-1).
 */

/** This browser's push endpoint, or "" where there is none (no service worker, no subscription). */
async function thisBrowsersPushEndpoint(): Promise<string> {
  try {
    if (!("serviceWorker" in navigator)) return "";
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    return sub?.endpoint ?? "";
  } catch {
    return "";
  }
}

export function GuestForget() {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  if (!asking) {
    return (
      <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: "6px 10px" }} onClick={() => setAsking(true)}>
        <Icon name="sign-out" /> {PLAYER_LINK_WORDS.forget}
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <button
        type="button"
        className="btn btn-primary"
        style={{ fontSize: 13, padding: "6px 10px" }}
        disabled={pending}
        onClick={() =>
          start(async () => {
            // This browser's push endpoint, so the guest's notices stop on this phone too (SEC-1).
            await forgetThisPhone(await thisBrowsersPushEndpoint());
            window.location.assign("/p");
          })
        }
      >
        Forget
      </button>
      <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: "6px 10px" }} onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  );
}

/**
 * A BROWSER HOLDING BOTH A SIGN-IN AND A PLAYER LINK (the review's S4): one
 * line saying which this screen is looking through, and the other beside it.
 * The two are never merged; pressing switches between two things this browser
 * already holds and grants nothing new.
 */
export function PlayerViewSwitchLine({ line, button, to }: { line: string; button: string; to: "guest" | "account" }) {
  const [pending, start] = useTransition();
  return (
    <div
      className="no-print"
      data-testid="player-view-switch"
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "8px 16px", borderBottom: "1px solid var(--color-divider)", fontSize: 13 }}
    >
      <span style={{ minWidth: 0 }}>{line}</span>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ fontSize: 13, padding: "4px 10px" }}
        disabled={pending}
        onClick={() =>
          start(async () => {
            await choosePlayerView(to);
            window.location.assign("/me");
          })
        }
      >
        {button}
      </button>
    </div>
  );
}
