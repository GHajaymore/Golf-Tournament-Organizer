"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { currentPlayStatus } from "@/app/actions/play-status";
import { alarmOnChange } from "@/lib/domain/play-status";

/** How often an open player screen asks whether play is suspended. */
const POLL_MS = 20_000;
/** How long the siren sounds: long enough to be heard from the next fairway. */
const SIREN_SECONDS = 4;

/**
 * THE ALARM ON AN OPEN PLAYER SCREEN when the committee suspends play (Ajay,
 * 2026-09-28: "can you also add an alarming sound?").
 *
 * A two-tone siren synthesised in the browser — no audio file to fetch on a
 * patchy course signal — plus a long vibration, then a refresh so the banner
 * shows. It sounds only on a change this screen SAW (`alarmOnChange`).
 *
 * WHAT IT CANNOT DO, said plainly: a locked phone in a pocket is the
 * notification's job, and a web page cannot choose the sound the phone makes
 * for that — the push asks for a long vibration and to stay on screen instead
 * (`public/sw.js`). And a phone plays no sound from a page nobody has touched,
 * so the first tap anywhere in the app unlocks it; a player scoring has always
 * tapped.
 */
export function SuspensionAlarm({ suspended }: { suspended: boolean }) {
  const router = useRouter();
  const was = useRef(suspended);
  const audio = useRef<AudioContext | null>(null);

  // Unlock sound on the first touch — the only way a phone allows it later.
  useEffect(() => {
    const unlock = () => {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        audio.current ??= new Ctx();
        void audio.current.resume();
      } catch {
        // No audio on this device: the banner and the vibration still come.
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const { suspended: now } = await currentPlayStatus();
        const act = alarmOnChange(was.current, now);
        was.current = now;
        if (act === "siren") siren(audio.current);
        if (act) router.refresh();
      } catch {
        // Offline for a moment: the next poll asks again.
      }
    };
    const poll = setInterval(check, POLL_MS);
    // Waking the phone is exactly when somebody needs to know.
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);

  return null;
}

/** Hi-lo siren: alternating 960 Hz and 770 Hz, the pattern people know. */
function siren(ctx: AudioContext | null) {
  try {
    navigator.vibrate?.([700, 250, 700, 250, 700]);
  } catch {
    // Vibration unsupported; the sound and the banner remain.
  }
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    const t0 = ctx.currentTime;
    for (let i = 0; i < SIREN_SECONDS * 2.5; i += 1) {
      osc.frequency.setValueAtTime(i % 2 === 0 ? 960 : 770, t0 + i * 0.4);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.05);
    gain.gain.setValueAtTime(0.35, t0 + SIREN_SECONDS - 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + SIREN_SECONDS);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + SIREN_SECONDS);
  } catch {
    // Audio refused: the vibration and the banner remain.
  }
}
