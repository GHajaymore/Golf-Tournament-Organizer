import { describe, it, expect } from "vitest";
import { orgProfile, ORG_KINDS } from "../org-profile";

/**
 * "SOCIETY" IS A BRITISH WORD AND THE APP SAID IT WORLDWIDE.
 *
 * Asked for 2026-09-11. The same outfit is a *society* in Britain and Ireland
 * and a *golf league* or *association* in the United States. `club` and
 * `outing` are understood everywhere, so this is one noun set on one kind.
 *
 * Two things this file exists to hold still, both of which are the ways a
 * wording change goes wrong rather than the wording itself.
 */

describe("the community noun follows the club's own country", () => {
  it("says society by default, exactly as it always did", () => {
    // The fallback is load-bearing: `Organization.country` is free text
    // defaulting to "", so "no answer" is the COMMON case, not an edge one.
    for (const c of ["", null, undefined, "Unknown", "Narnia"]) {
      const p = orgProfile("community", c);
      expect(p.noun, `country=${JSON.stringify(c)}`).toBe("society");
      expect(p.settingsLabel).toBe("Society settings");
    }
  });

  it("says league in the United States", () => {
    const p = orgProfile("community", "US");
    expect(p.noun).toBe("league");
    expect(p.label).toBe("League or association");
    expect(p.settingsLabel).toBe("League settings");
    expect(p.groupLabel).toBe("League");
    expect(p.blurb).toMatch(/league, association/i);
  });

  it("reads the country however it was written", () => {
    /**
     * Not a string comparison. Doing this by hand is how the course catalogue
     * ended up with 187 rows of "GB" beside 10 of "United Kingdom" — the same
     * country, counted twice, which also defeated a `country !== "US"` check
     * elsewhere in the app.
     */
    for (const spelling of ["US", "us", "USA", "United States", "united states of america"]) {
      expect(orgProfile("community", spelling).noun, spelling).toBe("league");
    }
  });

  it("leaves every other kind alone in every country", () => {
    // A club is a club and an outing is an outing, wherever it is played.
    for (const country of ["", "US", "GB", "IE", "AU"]) {
      expect(orgProfile("club", country).noun).toBe("club");
      expect(orgProfile("personal", country).noun).toBe("outing");
    }
  });

  it("does NOT call an Australian community a club", () => {
    /**
     * The register's third example — an AU outfit is "often just a club" — is
     * deliberately not implemented, and this pins the decision so it is made
     * rather than drifted into.
     *
     * Calling a `community` a "club" collides head-on with the `club` KIND: an
     * Australian society and an Australian golf club would then read
     * identically on every screen, which is worse than the British word. If
     * somebody decides that trade is worth making, this test is where they say
     * so.
     */
    expect(orgProfile("community", "AU").noun).toBe("society");
  });
});

describe("the country changes words, and nothing else", () => {
  /**
   * THE FAILURE THIS FILE IS REALLY FOR. Every flag on a profile is a fact
   * about how the outfit runs its golf — whether it keeps a shared roster,
   * whether one person fronted the minibus and is owed by nine others, whether
   * a season table means anything. None of that is decided by geography: a
   * society in Boston still fronts the minibus.
   *
   * "Translate the nouns" is exactly the shape of change that quietly takes a
   * behavioural flag with it, and a flag flipped by a country would be
   * invisible until somebody's ledger vanished.
   */
  const BEHAVIOUR = ["sharedRoster", "ledger", "seasonPlay", "ownsCourse"] as const;

  it("no country flips any behavioural flag, on any kind", () => {
    for (const kind of ORG_KINDS) {
      const base = orgProfile(kind);
      for (const country of ["US", "GB", "IE", "AU", "CA", "Unknown", "Narnia"]) {
        const p = orgProfile(kind, country);
        for (const flag of BEHAVIOUR) {
          expect(p[flag], `${kind} in ${country} changed ${flag}`).toBe(base[flag]);
        }
        expect(p.kind, `${kind} in ${country} changed kind`).toBe(base.kind);
      }
    }
  });

  it("the sweep is looking at flags that exist", () => {
    // A control: a renamed flag would otherwise make the loop above assert
    // `undefined === undefined` for every kind and pass on nothing.
    const p = orgProfile("community");
    for (const flag of BEHAVIOUR) {
      expect(typeof p[flag], `${flag} is not on the profile any more`).toBe("boolean");
    }
  });
});

describe("every word an outfit is named by comes from one place", () => {
  it("varies all five strings together, never some of them", () => {
    /**
     * `orgProfile` exists because a sidebar saying one thing and a heading
     * saying another is this codebase's most-repeated defect — it once showed
     * "Club settings" to a solo organizer while the same page correctly said
     * "Personal". A country that changed `noun` but not `settingsLabel` would
     * reintroduce exactly that, one country at a time.
     */
    const gb = orgProfile("community", "GB");
    const us = orgProfile("community", "US");
    const differ = (["label", "noun", "settingsLabel", "groupLabel", "blurb"] as const).filter(
      (k) => gb[k] !== us[k],
    );
    expect(differ.sort(), "a country changed some of the wording but not all of it").toEqual(
      ["blurb", "groupLabel", "label", "noun", "settingsLabel"],
    );
  });
});
