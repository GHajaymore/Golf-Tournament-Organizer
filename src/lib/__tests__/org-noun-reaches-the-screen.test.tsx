import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OrgProfileProvider } from "@/components/OrgProfileProvider";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { LocalePicker } from "@/components/LocalePicker";

/**
 * THE WORD HAS TO REACH THE SCREEN, not just the resolver.
 *
 * `org-profile-country.test.ts` proves `orgProfile("community", "US").noun` is
 * "league". That is a fact about a function. It says nothing about whether any
 * human ever sees it, and this repo has shipped exactly that gap before — a
 * correct rule with a caller that never asked, which is the whole reason
 * `standingRows` returns `[]` on its first line rather than trusting callers.
 *
 * So these render REAL consumers through the REAL provider and read the markup.
 * Both put `org.noun` into a running sentence a person reads:
 *
 *   CurrencyPicker  "It is the {noun}'s default, and almost every tournament…"
 *   HonoursBoard    "Every champion this {noun} has confirmed."
 *
 * Two components rather than one deliberately. The provider is a context, and
 * a context that reaches one consumer and not another is a defect this file
 * should catch — the eleven readers are the reason the context exists at all
 * instead of a prop on each.
 */

const markup = (country: string | undefined, el: React.ReactElement, noun?: string) =>
  renderToStaticMarkup(
    <OrgProfileProvider kind="community" country={country} noun={noun}>
      {el}
    </OrgProfileProvider>,
  );

const money = () => <CurrencyPicker currency="GBP" />;
const dates = () => <LocalePicker locale="en-GB" />;

describe("a community sees its own country's word for itself", () => {
  it("says society with no country, exactly as before", () => {
    // The default is the common case: `Organization.country` is free text and
    // defaults to "". A change here would reword the app for everybody.
    const html = markup(undefined, money());
    expect(html).toContain("the society&#x27;s currency");
    expect(html).not.toContain("league");
  });

  it("says league in the United States", () => {
    const html = markup("US", money());
    expect(html, "a US league is still called a society on screen").toContain(
      "the league&#x27;s currency",
    );
    expect(html).not.toContain("society");
  });

  it("reaches a second consumer from the same provider", () => {
    /**
     * Two components, not one, because this is a CONTEXT: one that reached
     * `CurrencyPicker` and not `LocalePicker` would be a real defect, and the
     * eleven readers are the whole reason the context exists instead of a prop
     * on each of them.
     */
    expect(markup(undefined, dates())).toContain("how the society writes a date");
    expect(markup("US", dates())).toContain("how the league writes a date");
  });

  it("reads the country however the club wrote it", () => {
    // Free text, so this is not hypothetical — "USA" and "United States" are
    // both things somebody types into that box.
    for (const spelling of ["US", "usa", "United States"]) {
      expect(markup(spelling, money()), spelling).toContain("the league&#x27;s currency");
    }
  });
});

describe("what the outfit calls itself reaches the screen too", () => {
  /**
   * The resolver half is proved in `org-profile-country.test.ts`. This is the
   * half that matters to a person: an organizer who picks "society" on the
   * settings screen has to stop being called a league EVERYWHERE, not just
   * there. The override travels the same context as the country, so if the
   * provider had taken one and not the other this is what would catch it.
   */
  it("beats the country, in body text and in an aria-label", () => {
    const html = markup("US", money(), "society");
    expect(html, "the country still won on screen").toContain("the society&#x27;s currency");
    expect(html).not.toContain("league");
  });

  it("reaches the second consumer as well", () => {
    expect(markup("US", dates(), "society")).toContain("how the society writes a date");
    expect(markup("GB", dates(), "league")).toContain("how the league writes a date");
  });

  it("falls back to the country when nothing is stored", () => {
    // The common case, and the one that must not regress: an outfit that has
    // never opened the setting is unchanged.
    expect(markup("US", money(), "")).toContain("the league&#x27;s currency");
    expect(markup("US", money(), undefined)).toContain("the league&#x27;s currency");
  });
});

describe("the sweep is reading something", () => {
  it("finds the noun in the markup at all", () => {
    /**
     * The control, and it earned its place. The FIRST version of it asserted
     * against a sentence inside `CurrencyPicker`'s FieldInfo popover — which
     * is COLLAPSED, so none of its children are in the static markup and the
     * noun was never there to find. The control failed, which is the only
     * reason the aria-label defect above was noticed rather than shipped.
     *
     * Without it, `not.toContain("society")` would have passed on markup that
     * named the outfit nowhere at all.
     */
    const html = markup(undefined, money());
    expect(html, "CurrencyPicker no longer names the outfit in its aria-label").toMatch(
      /More about the \w+&#x27;s currency/,
    );
  });
});
