"use client";
import { createContext, useContext } from "react";
import { golfTermsFor, type GolfRegister, type GolfWords } from "@/lib/domain/golf-terms";

/**
 * THE CLUB'S GOLF WORDS, provided once for every client component on a screen.
 *
 * The same argument as `OrgProfileProvider` beside it: one fact about the club,
 * read by a dozen components, where the prop somebody forgets is a Scottish
 * club told about its "carts" and a US league told it is a "society". Set in
 * the console layout and the player layout from the same club the rest of the
 * shell reads, and on `/match/new` for the casual round's form.
 *
 * The REGISTER is what crosses to the browser, not the words: three letters,
 * and the words are then `golfTermsFor`'s — the one table.
 *
 * With no provider it answers US, the app's default for a club that has not
 * said. `country-words.test.ts` pins that every component reading this is
 * drawn under a layout that provides it.
 */
const GolfTermsContext = createContext<GolfWords>(golfTermsFor("us"));

const GolfRegisterContext = createContext<GolfRegister>("us");

export function GolfTermsProvider({ register, children }: { register: GolfRegister; children: React.ReactNode }) {
  return (
    <GolfRegisterContext.Provider value={register}>
      <GolfTermsContext.Provider value={golfTermsFor(register)}>{children}</GolfTermsContext.Provider>
    </GolfRegisterContext.Provider>
  );
}

/** The register itself, for the few readers that need more than the words (the kinds of play a club is offered). */
export function useGolfRegister(): GolfRegister {
  return useContext(GolfRegisterContext);
}

export function useGolfTerms(): GolfWords {
  return useContext(GolfTermsContext);
}
