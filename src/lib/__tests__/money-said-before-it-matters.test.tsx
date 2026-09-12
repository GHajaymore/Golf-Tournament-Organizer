import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MoneyModeLine } from "@/components/MoneyModeLine";
import { MONEY_MODE_LABEL } from "@/lib/domain/money-mode";
import { readSource } from "./source";

/**
 * THE MODE IS STATED BEFORE THE THINGS IT DECIDES, NOT AFTER THEM.
 *
 * `resolveMoneyMode` decides what every card on the prizes screen MEANS —
 * whether there is a kitty, whether shared costs are split, whether the app is
 * involved in the entry fee at all — and the control for it was the LAST thing
 * on that screen, below the ledger it governs:
 *
 *     PrizesClient → SkinsPotClient → ContestsClient → SkinsSeason
 *     → FloatClient → OrganizerLedger → MoneySetup
 *
 * So an organizer read a settle-up and then found out whether the settle-up
 * applied to them. And the club's own setup step promises "Changeable per
 * tournament later" without saying where, which made scrolling to the bottom
 * of Prizes the only way to keep that promise.
 *
 * Two halves, both asserted here: the STATEMENT says which mode is in force
 * and how it was arrived at, and the screen puts it above the consequences.
 */

const line = (over: Partial<Parameters<typeof MoneyModeLine>[0]> = {}) =>
  renderToStaticMarkup(
    <MoneyModeLine
      eventMode=""
      orgMode=""
      orgKind="club"
      clubName="Ridgeway"
      href="#money-setup"
      {...over}
    />,
  );

describe("what the screen says about money before it shows any", () => {
  it("names the mode actually in force, not the one stored here", () => {
    /**
     * The tournament stores nothing, so the answer comes from the club — which
     * is the case the screen was silent about. Asserted through
     * `MONEY_MODE_LABEL` rather than the words, because the label is the
     * sidebar-style rule: the picker below and the statement above must call
     * one mode one thing.
     */
    expect(line({ eventMode: "", orgMode: "float" })).toContain(MONEY_MODE_LABEL.float);
    expect(line({ eventMode: "split", orgMode: "float" })).toContain(MONEY_MODE_LABEL.split);
    // A club with nothing set anywhere still gets a real answer rather than a
    // blank: `resolveMoneyMode` falls back on the kind.
    expect(line({ eventMode: "", orgMode: "", orgKind: "club" })).toContain(MONEY_MODE_LABEL.none);
    expect(line({ eventMode: "", orgMode: "", orgKind: "community" })).toContain(MONEY_MODE_LABEL.split);
  });

  it("says whether this tournament is following the club or has decided", () => {
    /**
     * The question somebody asks the moment two tournaments in the same club
     * behave differently, and the one the mode alone cannot answer: "following"
     * and "decided here" are the difference between a change on Club settings
     * reaching this tournament and not.
     */
    const following = line({ eventMode: "", orgMode: "float", clubName: "Ridgeway" });
    expect(following).toContain("Ridgeway");
    expect(following).toMatch(/following/i);

    const chosen = line({ eventMode: "split", orgMode: "float", clubName: "Ridgeway" });
    expect(chosen).toMatch(/this tournament/i);
    expect(chosen, "a tournament that has chosen is not following anybody").not.toMatch(/Following Ridgeway/);
  });

  it("falls back to the right word for the outfit when it has no name", () => {
    // "Following the society", not "Following the club" — the slip this
    // codebase keeps rediscovering, most recently as "Name your personal".
    // `community` is the kind; "society" is the word `orgProfile` gives it,
    // which is the whole point of reading the noun rather than writing one.
    expect(line({ eventMode: "", orgMode: "float", clubName: "", orgKind: "community" })).toMatch(
      /following the society/i,
    );
    expect(line({ eventMode: "", orgMode: "float", clubName: "", orgKind: "club" })).toMatch(
      /following the club/i,
    );
  });

  it("offers the jump only to somebody who can change it", () => {
    // A player has nothing to jump to: the picker is staff-only, and a link to
    // a control that is not on their copy of the screen is a dead end.
    expect(line({ href: "#money-setup" })).toContain("#money-setup");
    expect(line({ href: undefined })).not.toContain("#money-setup");
  });
});

describe("where the prizes screen puts it", () => {
  const page = () => readSource("src", "app", "(app)", "prizes", "page.tsx");

  it("states the mode above everything the mode decides", () => {
    /**
     * The fix itself, and the half a component test cannot see. Every one of
     * these reads differently depending on the mode — the ledger and the kitty
     * only exist in one of them — so the statement has to come first.
     */
    const src = page();
    const at = (s: string) => src.indexOf(s);
    expect(at("<MoneyModeLine"), "the statement is gone").toBeGreaterThan(-1);
    for (const after of ["<PrizesClient", "<SkinsPotClient", "<FloatClient", "<OrganizerLedger", "<MoneySetup"]) {
      expect(at("<MoneyModeLine"), `${after} is above the statement`).toBeLessThan(at(after));
    }
  });

  it("keeps the picker at the foot, where the settings are", () => {
    /**
     * A STATEMENT, NOT A SECOND COPY OF THE PICKER. Radios at the top would
     * push the prizes themselves below the fold to solve a problem that is
     * about KNOWING rather than about changing — and two controls for one
     * setting on one screen is how they come to disagree.
     */
    const src = page();
    expect(src.split("<MoneySetup").length - 1, "the picker has been duplicated").toBe(1);
    expect(src.indexOf("<MoneySetup")).toBeGreaterThan(src.indexOf("<OrganizerLedger"));
  });

  it("has somewhere for the jump to land", () => {
    // The anchor the statement links to. Without it "Change" scrolls nowhere
    // and the statement becomes a dead end — worse than no link.
    expect(page()).toContain('id="money-setup"');
  });
});
