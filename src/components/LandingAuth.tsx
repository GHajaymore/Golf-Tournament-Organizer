"use client";
import { useEffect, useState } from "react";
import { LoginPanel } from "@/components/LoginPanel";
import { SIGNINS_CLOSED_NOTICE } from "@/lib/sign-in-gate";

/**
 * The real sign-in form, embedded in the landing page so every "Sign in" and
 * "Start free" call-to-action has somewhere on the page to land.
 *
 * The CTAs are plain anchors to #signin / #signup (which resolve to the anchor
 * spans just above this in the auth section, so they scroll correctly even
 * before hydration). This watches the hash so "Start free" opens the panel in
 * its sign-up state, while "Sign in" opens it logged-in — the panel keeps its
 * own two-tab control either way, so a visitor can still switch.
 *
 * `key={mode}` remounts LoginPanel when the intent changes, which is what makes
 * `initialMode` take effect on a second click without LoginPanel needing to
 * reconcile a prop against internal tab state.
 */
export function LandingAuth({
  defaultMode = "login",
  organizers = "organizers",
  closed = false,
}: { defaultMode?: "login" | "signup"; organizers?: string; closed?: boolean } = {}) {
  // Where no link said otherwise: the closing section asks the visitor to set
  // up their first event, so it opens on sign-up (Ajay, 2026-09-28).
  const [mode, setMode] = useState<"login" | "signup">(defaultMode);

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash;
      if (hash === "#signup") setMode("signup");
      else if (hash === "#signin") setMode("login");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // No autofocus: an autofocused input scrolls itself into view on mount, which
  // would land a first-time visitor halfway down the page at the login box
  // instead of the top of the hero.
  // The edition's word (UK "organisers"): the page's server-side dialect swap
  // cannot reach inside this client component, so the word is passed in.
  const panel = <LoginPanel key={closed ? "held" : mode} initialMode={mode} autoFocusFields={false} organizers={organizers} signupClosed={closed} />;
  if (!closed) return panel;
  // Sign-ins held until launch (sign-in-gate.ts): said before the form, and the form below is
  // signing in only — no Sign up tab, so nobody is offered an account the server would refuse.
  // It stays for the owners the hold lets through.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        role="status"
        style={{
          width: "min(400px, 100%)",
          padding: "16px 18px",
          borderRadius: 14,
          background: "var(--color-surface)",
          color: "var(--color-text)",
          fontSize: 15,
          lineHeight: 1.55,
          boxShadow: "0 0 0 2px var(--color-accent)",
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>{SIGNINS_CLOSED_NOTICE.lead}</strong> {SIGNINS_CLOSED_NOTICE.body}
        </p>
        <p style={{ margin: "8px 0 0" }}>
          {SIGNINS_CLOSED_NOTICE.interestedLead} Write to{" "}
          <a
            href={`mailto:${SIGNINS_CLOSED_NOTICE.interestedEmail}?subject=${encodeURIComponent("Interested in TourneyHQ")}`}
            style={{ color: "inherit", fontWeight: 700, textDecoration: "underline" }}
          >
            {SIGNINS_CLOSED_NOTICE.interestedEmail}
          </a>{" "}
          {SIGNINS_CLOSED_NOTICE.interestedTail}
        </p>
        <p style={{ margin: "8px 0 0" }}>
          {SIGNINS_CLOSED_NOTICE.playLead}{" "}
          <a href="/play" style={{ color: "inherit", fontWeight: 700, textDecoration: "underline" }}>
            {SIGNINS_CLOSED_NOTICE.playLink}
          </a>{" "}
          {SIGNINS_CLOSED_NOTICE.playTail}
        </p>
      </div>
      {panel}
    </div>
  );
}
