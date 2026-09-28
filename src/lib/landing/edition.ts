import { golfRegister, golfTermsFor, type GolfRegister } from "@/lib/domain/golf-terms";
import { countryCode } from "@/lib/domain/country";
import type { PlanCurrency } from "@/lib/plans";
import { DEFAULT_LOCALE } from "@/lib/domain/locale";

/**
 * THE FRONT DOOR'S COUNTRY EDITION.
 *
 * Ajay, 2026-09-27: "local by default and overridden option for USD and US
 * terminologies … including currency and golf terminologies", and US is the
 * default. So a visitor from Britain sees pounds and buggies, a visitor from
 * anywhere unlisted sees dollars and carts, and anyone can switch to US $ and
 * US terms with one button.
 *
 * Decided on the server from the request's country (Vercel's
 * `x-vercel-ip-country`), so the page arrives already in the visitor's words —
 * no flash of the wrong currency while a script catches up, and a crawler sees
 * the same page a person does.
 *
 * WHAT THIS DOES NOT OWN:
 *  - the golf words themselves, which are `golf-terms.ts`'s — the one table
 *    the app's own screens use, so the landing cannot say "buggy" where the app
 *    says "cart";
 *  - the plan prices, which come from `effectivePrice(plan, overrides,
 *    currency)` — this only says WHICH currency;
 *  - which countries speak UK golf, which is `golfRegister`'s list. The EU
 *    edition is exactly "UK golf, and not one of the named countries", so the
 *    eurozone is listed once, there.
 */

export type EditionKey = "US" | "CA" | "GB" | "IE" | "EU" | "AU" | "NZ" | "ZA";

/** How the page's English is spelled, which is not the same question as the golf words. */
type Spelling = "us" | "ca" | "uk";

export interface Edition {
  key: EditionKey;
  currency: PlanCurrency;
  /** How numbers and money are written. */
  locale: string;
  /** Which golf the page speaks — `golf-terms.ts`'s register. */
  register: GolfRegister;
  spelling: Spelling;
  /** For the switch: "Prices in GBP for the United Kingdom." */
  name: string;
  /** Which set of screenshots: the demo club captured as a US club, or as a UK one. */
  shots: "us" | "uk";
}

const EDITIONS: Record<EditionKey, Omit<Edition, "key" | "register" | "locale">> = {
  US: { currency: "USD", spelling: "us", name: "the United States", shots: "us" },
  // Canada plays in carts and foursomes (golf-terms.ts) and spells "colour".
  CA: { currency: "CAD", spelling: "ca", name: "Canada", shots: "us" },
  GB: { currency: "GBP", spelling: "uk", name: "the United Kingdom", shots: "uk" },
  IE: { currency: "EUR", spelling: "uk", name: "Ireland", shots: "uk" },
  EU: { currency: "EUR", spelling: "uk", name: "Europe", shots: "uk" },
  AU: { currency: "AUD", spelling: "uk", name: "Australia", shots: "uk" },
  NZ: { currency: "NZD", spelling: "uk", name: "New Zealand", shots: "uk" },
  ZA: { currency: "ZAR", spelling: "uk", name: "South Africa", shots: "uk" },
};

/** The one cookie the switch sets: "1" means "show me US $ and US terms". */
export const US_OVERRIDE_COOKIE = "thq-us";

export function editionFor(country: string | null | undefined): Edition {
  const code = countryCode(country ?? "");
  const named = code === "UK" ? "GB" : code;
  const key: EditionKey =
    named in EDITIONS && named !== "EU"
      ? (named as EditionKey)
      : golfRegister(code) === "uk"
        ? "EU"
        : "US";
  return { key, ...EDITIONS[key], locale: localeFor(key), register: key === "US" || key === "CA" ? "us" : "uk" };
}

/**
 * How the page writes numbers and money: English as it is written in the
 * visitor's country — en-GB, en-AU, en-ZA — and the app's own default for the
 * US. The eurozone reads Irish English, the one English of the euro. There is
 * no club here to ask (the rule `no-hardcoded-locale.test.ts` holds everywhere
 * else), so the edition itself is the answer, derived rather than tabled.
 */
function localeFor(key: EditionKey): string {
  if (key === "US") return DEFAULT_LOCALE;
  return `en-${key === "EU" ? "IE" : key}`;
}

/**
 * What to render: the visitor's own edition, or the US one if they asked for
 * it. `local` is kept either way, so the switch can offer the way back.
 */
export function landingEdition(country: string | null | undefined, usOverride: boolean) {
  const local = editionFor(country);
  const shown = usOverride ? editionFor("US") : local;
  return { local, shown, overridden: usOverride && local.key !== "US" };
}

/** A word swap: a pattern and what it becomes. */
export type WordSwap = readonly [RegExp, string];

/**
 * The swaps for one edition. The page is AUTHORED IN US ENGLISH — the default
 * edition — so a US visitor gets no swaps at all.
 *
 * THE GOLF WORDS ARE READ FROM `golf-terms.ts`, never restated here, and only
 * the lower-case forms are swapped for the group term: "Foursomes" with a
 * capital is a FORMAT name on this page, and a format name never changes
 * (UK "foursomes" is alternate shot). `strokeCompetition` is deliberately not
 * swapped either — "stroke play" here always names the format.
 *
 * What IS stated here is English spelling, which is not a golf term, and the
 * one audience word the page uses ("golf group" → "society").
 */
export function editionSwaps(edition: Edition): WordSwap[] {
  const swaps: WordSwap[] = [];
  if (edition.register === "uk") {
    const us = golfTermsFor("us");
    const uk = golfTermsFor(edition.register);
    const both = (from: string, to: string, capitalise: boolean) => {
      swaps.push([new RegExp(`\\b${from}\\b`, "g"), to]);
      if (capitalise) swaps.push([new RegExp(`\\b${cap(from)}\\b`, "g"), cap(to)]);
    };
    // Longest first, so "carts" is not read as "cart" + "s".
    both(us.carts, uk.carts, true);
    both(us.cart, uk.cart, true);
    both(us.organizers, uk.organizers, true);
    both(us.organizer, uk.organizer, true);
    both(us.groups, uk.groups, false);
    both(us.group, uk.group, false);
    swaps.push(
      [/\bLeagues & golf groups\b/g, "Leagues & societies"],
      [/\bgolf groups\b/g, "societies"],
      [/\bgolf group\b/g, "society"],
    );
  }
  if (edition.spelling !== "us") {
    swaps.push(
      [/\bcolor(s|ed)?\b/g, "colour$1"],
      [/\bColor(s|ed)?\b/g, "Colour$1"],
      [/\bhonors\b/g, "honours"],
      [/\bHonors\b/g, "Honours"],
    );
  }
  if (edition.spelling === "uk") {
    swaps.push(
      [/\borganiz(e|ed|ing)\b/g, "organis$1"],
      [/\bOrganiz(e|ed|ing)\b/g, "Organis$1"],
      [/\bprogram\b/g, "programme"],
    );
  }
  return swaps;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function applySwaps(text: string, swaps: readonly WordSwap[]): string {
  return swaps.reduce((t, [re, to]) => t.replace(re, to), text);
}
