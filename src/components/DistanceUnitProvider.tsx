"use client";
import { createContext, useContext, useMemo } from "react";
import { distanceWords, isDistanceUnit, type DistanceUnit } from "@/lib/domain/distance-unit";

/**
 * WHAT A CARD ON SCREEN IS MEASURED IN — yards or metres.
 *
 * Two answers, because there are two questions:
 *
 *   card  what THIS course's card is in. A screen showing one round's card sets
 *         it from that course, because a society touring France plays a card in
 *         metres whatever its home country says.
 *   club  what a NEW course will be in — the club's country's unit. A form for
 *         adding a course labels its boxes with this, because a course saved
 *         without a unit resolves to exactly this.
 *
 * The layout sets both from the club. A card screen nested inside overrides the
 * card and keeps the club, so a "new venue" form sitting inside a score-entry
 * screen still says the club's word rather than the round's.
 *
 * A context rather than a prop, because the distances reach the label through
 * five components (PlayerCard → GroupScoring → HoleByHoleCard, and the rest) and
 * the prop somebody forgets is a card quietly back in yards. With no provider at
 * all both say yards — what every card said before this existed, so an unwired
 * screen is unchanged rather than broken.
 */
const DistanceUnitContext = createContext<{ card: DistanceUnit; club: DistanceUnit }>({ card: "yards", club: "yards" });

export function DistanceUnitProvider({
  unit,
  club,
  children,
}: {
  /** The card on screen. */
  unit: string | null | undefined;
  /** The club's unit; omitted by a card screen, which inherits the layout's. */
  club?: string | null;
  children: React.ReactNode;
}) {
  const parent = useContext(DistanceUnitContext);
  const value = useMemo(
    () => ({
      card: isDistanceUnit(unit) ? unit : "yards",
      club: isDistanceUnit(club) ? club : parent.club,
    }),
    [unit, club, parent.club],
  );
  return <DistanceUnitContext.Provider value={value}>{children}</DistanceUnitContext.Provider>;
}

/** The unit of the card on screen. */
export function useDistanceUnit(): DistanceUnit {
  return useContext(DistanceUnitContext).card;
}

/** The label words for the card on screen: "Yards"/"yds" or "Metres"/"m". */
export function useDistanceWords() {
  return distanceWords(useDistanceUnit());
}

/** The club's unit — for a form that adds a NEW course. */
export function useClubDistanceUnit(): DistanceUnit {
  return useContext(DistanceUnitContext).club;
}

/** The club's label words — for a form that adds a NEW course. */
export function useClubDistanceWords() {
  return distanceWords(useClubDistanceUnit());
}
