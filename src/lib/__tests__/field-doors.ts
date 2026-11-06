import { FIELD_CHANGES, fieldDoors, type FieldChange } from "@/lib/domain/field-change";

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
});

/** A launched tournament of the given family, with or without a round begun or a confirmed draw. */
export function liveDoors(family: Parameters<typeof fieldDoors>[0]["family"], playedRound: string | null = null, flightsConfirmed = false) {
  return fieldDoors({ status: "live", configUnlocked: false, family, playedRound, flightsConfirmed });
}

// Every change has a door: the control a fixture that forgot one would fail.
if (FIELD_CHANGES.some((c) => !(c in OPEN_DOORS))) throw new Error("a field change has no door");
