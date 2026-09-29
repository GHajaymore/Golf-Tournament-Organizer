"use client";
import { useEffect, useState } from "react";
import { LoginPanel } from "@/components/LoginPanel";

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
}: { defaultMode?: "login" | "signup"; organizers?: string } = {}) {
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
  return <LoginPanel key={mode} initialMode={mode} autoFocusFields={false} organizers={organizers} />;
}
