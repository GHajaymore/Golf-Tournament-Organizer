"use client";
import { createContext, useContext } from "react";
import { orgProfile, type OrgProfile } from "@/lib/domain/org-profile";

/**
 * What kind of outfit this is, provided once for every screen that names it.
 *
 * Set in the console layout beside the currency and the theme, and for exactly
 * the same reason `CurrencyProvider` gives: it is one fact belonging to the
 * organization, read by a dozen screens, and the alternative is a prop
 * threaded through every client component and every page that renders one —
 * where the prop somebody forgets is a screen quietly calling a society a
 * club.
 *
 * WHICH IS NOT A COSMETIC COMPLAINT. `org-profile.ts` was written because
 * "Club settings" was shown to a solo organizer who has no club, and
 * `settingsLabel` exists to stop it. The same sentence is still written out by
 * hand across the console: a society is told to add its club's logo, to pick
 * its club's home course, that a name joins the club roster, that the club
 * settles up. A society playing a different course every month has no home
 * course and no club, and a charity day organizer has neither and no members
 * either.
 *
 * Defaults to the CLUB profile with no provider, which is what every one of
 * those screens said before this existed — so a surface nobody has wired yet
 * is unchanged rather than newly wrong.
 */
const OrgProfileContext = createContext<OrgProfile>(orgProfile("club"));

export function OrgProfileProvider({
  kind,
  children,
}: {
  kind: string | null | undefined;
  children: React.ReactNode;
}) {
  return (
    <OrgProfileContext.Provider value={orgProfile(kind ?? "club")}>{children}</OrgProfileContext.Provider>
  );
}

/**
 * The profile of the organization whose console this is.
 *
 * `noun` is the one to reach for inside a sentence — "your society's logo",
 * "the society settles up". `label` is a heading or a chip and does NOT
 * survive being dropped into running text: "Add your Society or league's
 * logo" is not English, which is the mistake `noun` was added to prevent.
 */
export function useOrgProfile(): OrgProfile {
  return useContext(OrgProfileContext);
}

/**
 * `noun` at the start of a label — "Society's home course".
 *
 * Here rather than at each call site because a label is written in one place
 * and read in another, and `noun.charAt(0).toUpperCase() + noun.slice(1)`
 * copied into four components is four chances to write `toUpperCase()` on the
 * whole word. `label` is not the answer: "Society or league's home course" is
 * the sentence `noun` exists to avoid.
 */
export function leadingNoun(noun: string): string {
  return noun ? noun[0].toUpperCase() + noun.slice(1) : noun;
}
