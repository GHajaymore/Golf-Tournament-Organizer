import { describe, it, expect } from "vitest";
import {
  orgProfile,
  ORG_KINDS,
  COMMUNITY_VOICES,
  COMMUNITY_VOICE_KEYS,
  isCommunityVoice,
} from "../org-profile";

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

describe("the organizer overrules the country", () => {
  /**
   * THE COUNTRY IS THE DEFAULT; THE ORGANIZER IS THE AUTHORITY.
   *
   * A country can only ever be a good guess. A US outfit that has always
   * called itself a society is not wrong about its own name, and an app that
   * keeps correcting it is worse than one that never guessed — which is why
   * the default half shipped with this half explicitly outstanding rather than
   * called finished.
   */
  it("uses the stored word instead of the country's", () => {
    const p = orgProfile("community", "US", "society");
    expect(p.noun, "the country still won").toBe("society");
    expect(p.settingsLabel).toBe("Society settings");
  });

  it("works in the other direction too", () => {
    // Not just "US outfits may opt out": a British society that runs itself as
    // a league can say so.
    expect(orgProfile("community", "GB", "league").noun).toBe("league");
    expect(orgProfile("community", "", "association").noun).toBe("association");
  });

  it("treats empty as a real answer meaning follow the country", () => {
    /**
     * Load-bearing, not an edge case. Empty is the state every row was in
     * before the column existed, and an organizer who picks a word and then
     * changes their mind has to be able to get back to it. If blank did not
     * resolve, that choice would be one-way.
     */
    for (const blank of ["", "   ", null, undefined]) {
      expect(orgProfile("community", "US", blank).noun, JSON.stringify(blank)).toBe("league");
      expect(orgProfile("community", "GB", blank).noun, JSON.stringify(blank)).toBe("society");
    }
  });

  it("falls through on a word it does not know, rather than throwing", () => {
    /**
     * This arrives from a free-text database column. A value written by a
     * later version of the app — or a typo — must not be able to break every
     * screen that names the outfit. Same direction of failure as an unknown
     * `kind` resolving to `personal`.
     */
    expect(orgProfile("community", "US", "guild").noun).toBe("league");
    expect(orgProfile("community", "GB", "guild").noun).toBe("society");
  });

  it("changes nothing for a club or an outing", () => {
    // Only the community kind reads it. A club is a club wherever it is
    // played, and the settings screen does not offer the control at all.
    for (const voice of ["league", "association", "society"]) {
      expect(orgProfile("club", "US", voice).noun).toBe("club");
      expect(orgProfile("personal", "GB", voice).noun).toBe("outing");
    }
  });

  it("offers every word it accepts, and accepts every word it offers", () => {
    /**
     * The picker is built from `COMMUNITY_VOICE_KEYS` and the server action
     * validates with `isCommunityVoice`. A key offered but refused would be a
     * dropdown entry that errors on selection; a key accepted but never
     * offered would be a stored value no organizer could have chosen.
     */
    for (const key of COMMUNITY_VOICE_KEYS) {
      expect(isCommunityVoice(key), `${key} is offered but not accepted`).toBe(true);
      expect(COMMUNITY_VOICES[key].noun, `${key} has no noun`).toBeTruthy();
    }
    expect(COMMUNITY_VOICE_KEYS.length).toBeGreaterThan(1);
    expect(isCommunityVoice("guild")).toBe(false);
  });

  it("keeps one definition of the default word", () => {
    /**
     * `PROFILES.community` and `COMMUNITY_VOICES.society` are the same five
     * strings, and two copies is the defect this whole file exists to prevent
     * — the next person to reword one would find a second to disagree with.
     * They share a constant; this is what says so out loud.
     */
    const plain = orgProfile("community");
    const chosen = orgProfile("community", "", "society");
    for (const k of ["label", "noun", "settingsLabel", "groupLabel", "blurb"] as const) {
      expect(chosen[k], `${k} drifted from the default`).toBe(plain[k]);
    }
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
  const BEHAVIOUR = ["sharedRoster", "ledger", "ownsCourse"] as const;

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

  it("and neither does the organizer's own choice", () => {
    /**
     * The override is a WORD, not a kind. An outfit calling itself a league
     * still keeps the shared roster and the settle-up, because those are facts
     * about how it runs its golf rather than about what it is called.
     *
     * Worth its own assertion rather than folding into the loop above: the
     * override arrives on a different argument, from a different source, and
     * "the country cannot do this" says nothing about whether the column can.
     */
    for (const kind of ORG_KINDS) {
      const base = orgProfile(kind);
      for (const voice of [...COMMUNITY_VOICE_KEYS, "guild", "", null]) {
        const p = orgProfile(kind, "US", voice);
        for (const flag of BEHAVIOUR) {
          expect(p[flag], `${kind} as "${voice}" changed ${flag}`).toBe(base[flag]);
        }
        expect(p.kind, `${kind} as "${voice}" changed kind`).toBe(base.kind);
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
