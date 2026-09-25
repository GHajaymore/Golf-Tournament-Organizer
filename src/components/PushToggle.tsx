"use client";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { getVapidPublicKey, savePushSubscription, removePushSubscription } from "@/app/actions/push";

/**
 * Turn on tee-time alerts — the opt-in for web push.
 *
 * Email is the wrong rail for a tee time posted an hour before play (Ajay,
 * 2026-09-24): players won't check an inbox in time. Push reaches the phone.
 * This is where a member grants it, once.
 *
 * DELIBERATELY SELF-EFFACING. Push needs three things a given browser may not
 * have — a service worker, the Push API, and Notifications — and iOS only
 * allows it in an INSTALLED PWA. Where any of that is missing, or push is not
 * configured on the server (no VAPID key), this renders nothing rather than
 * offering an alert that can never arrive. And once alerts are on it shrinks to
 * a single line, so it is a prompt, not a permanent fixture on a screen Ajay
 * asked to keep uncluttered.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "checking" | "unavailable" | "off" | "on" | "blocked";

export function PushToggle() {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (!supported) return setState("unavailable");
      // No registered service worker (e.g. the dev server never registers one)
      // means nothing to subscribe against — treat as unavailable rather than
      // offering a button that cannot work.
      const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
      if (!reg) return void (!cancelled && setState("unavailable"));
      if (Notification.permission === "denied") return void (!cancelled && setState("blocked"));
      const sub = await reg.pushManager.getSubscription().catch(() => null);
      if (!cancelled) setState(sub ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setError("");
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const key = await getVapidPublicKey();
      if (!key) {
        setState("unavailable");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: a Uint8Array is a BufferSource, but TS 5.7's typed-array
        // generics don't narrow the ArrayBufferLike backing to ArrayBuffer.
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
      const json = sub.toJSON();
      const res = await savePushSubscription({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn't turn on alerts.");
        return;
      }
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn on alerts.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setError("");
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe().catch(() => {});
      }
      setState("off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn off alerts.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "checking" || state === "unavailable") return null;

  if (state === "on") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--color-text-muted)" }}>
        <Icon name="megaphone" style={{ color: "var(--color-accent-300)" }} />
        <span>Tee-time alerts are on.</span>
        <button
          type="button"
          onClick={disable}
          disabled={busy}
          className="btn-link"
          style={{ fontSize: 12.5, padding: 0, background: "none", border: "none", color: "var(--color-accent-300)", cursor: "pointer", textDecoration: "underline" }}
        >
          {busy ? "…" : "Turn off"}
        </button>
      </div>
    );
  }

  return (
    <div className="card elev-sm" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <Icon name="megaphone" style={{ color: "var(--color-accent-300)", fontSize: 20, flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Get tee-time alerts</span>
        <span className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
          {state === "blocked"
            ? "Notifications are blocked for this site — turn them on in your browser settings to get alerts."
            : "A notification when your tee time is posted or changes — no email needed."}
        </span>
        {error && (
          <span className="form-error" style={{ fontSize: 12, marginTop: 2 }}>
            {error}
          </span>
        )}
      </span>
      {state !== "blocked" && (
        <button type="button" onClick={enable} disabled={busy} className="btn btn-secondary touch-target" style={{ flex: "none" }}>
          {busy ? "Turning on…" : "Turn on"}
        </button>
      )}
    </div>
  );
}
