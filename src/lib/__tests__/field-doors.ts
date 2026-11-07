import { FIELD_CHANGES, fieldDoors, type FieldChange, type FieldClock, type LastTeeTime } from "@/lib/domain/field-change";

/**
 * A club's clock for a fixture: 8:00 on the round's day, with no published
 * sheet unless one is given — so the late-entry window is PR A's first-card
 * rule unless a test asks for a tee time.
 */
export const NO_SHEET: FieldClock = { lastTee: null, now: { day: "2026-11-29", minutes: 8 * 60 } };

/**
 * The Entries screen's field doors for a render test — taken from the ONE rule
 * (`fieldDoors`), never typed by hand, so a test cannot draw a screen the rule
 * would never produce. `OPEN_DOORS` is a tournament still being set up.
 */
export const OPEN_DOORS: Record<FieldChange, string | null> = fieldDoors({
  status: "draft",
  configUnlocked: false,
  family: "stroke",
  playedRound: null,
  flightsConfirmed: false,
  ...NO_SHEET,
});

/** A launched tournament of the given family, with or without a round begun, a confirmed draw, or a published last tee time. */
export function liveDoors(
  family: Parameters<typeof fieldDoors>[0]["family"],
  playedRound: string | null = null,
  flightsConfirmed = false,
  clock: { lastTee: LastTeeTime | null; minutes?: number } = { lastTee: null },
) {
  return fieldDoors({
    status: "live",
    configUnlocked: false,
    family,
    playedRound,
    flightsConfirmed,
    lastTee: clock.lastTee,
    now: { day: NO_SHEET.now.day, minutes: clock.minutes ?? NO_SHEET.now.minutes },
  });
}

// Every change has a door: the control a fixture that forgot one would fail.
if (FIELD_CHANGES.some((c) => !(c in OPEN_DOORS))) throw new Error("a field change has no door");
