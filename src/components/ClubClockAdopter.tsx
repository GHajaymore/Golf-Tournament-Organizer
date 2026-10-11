"use client";
import { useEffect } from "react";
import { adoptClubTimeZone } from "@/app/actions/organization";

/**
 * A club with no time zone takes its organizer's, once.
 *
 * Drawn by the console layout ONLY while the club has none and the person
 * looking may change it. It draws nothing: it reads the device's zone after
 * mount — the server has no device — and hands it to `adoptClubTimeZone`,
 * which takes it only if the club still has none. See that action for why the
 * club is not asked a question instead.
 */
export function ClubClockAdopter() {
  useEffect(() => {
    let zone = "";
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      zone = "";
    }
    if (zone) void adoptClubTimeZone(zone);
  }, []);
  return null;
}
