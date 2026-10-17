import { test, expect, type Page, type Browser, type TestInfo } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { playScratch } from "./round-basis";
import { seedOrganizer, teardownOrganizer, medalEmail, memberSession } from "./organizer-fixture.mjs";

/**
 * A CLUB MATCH PLAY IN FLIGHTS, RUN FROM NOTHING BY A NEW ORGANIZER.
 *
 * A field too big for one bracket is divided into flights, each its own
 * straight knockout (Ajay, 2026-10-11: "it should be pure knockouts"). The
 * arithmetic is swept in `bracket-flights.test.ts` and the rules on real rows
 * in `a-knockout-in-flights.audit.test.ts`. This is the part only a browser
 * can show: that an organizer who has never seen the screen can get from a
 * field of ten to its champions, and that a player in the LOWEST flight is
 * told who they play.
 *
 *   field     ten — all a new club's free plan holds — entered out of handicap order
 *   arrange   Bracket → Arrangement → Several flights; nothing is drawn yet
 *   divide    by handicap, the organizer's own sizes: 4, 3, 3
 *   adjust    a player moved up and back (they rejoin at the FOOT), a flight renamed
 *   launch    which locks the arrangement and must NOT shut the division
 *   play      the top flight and the third flight to a champion, the middle one part-way
 *   read      the dashboard counts three flights and six of seven ties;
 *             a player in the third flight sees their tie, with their flight named
 *
 * THE FIELD. Indexes 0, 2, 4 … 18 in alphabetical order, so by handicap the
 * flights are Alder–Dune, Elm–Gorse, Hazel–Juniper. A flight of four plays
 * 1 v 4 and 2 v 3; a flight of THREE is a bracket of four with one bye, which
 * goes to its top seed, so its one first-round tie is 2 v 3. They are ENTERED
 * in another order, so a division taken from the entry list puts different
 * people together.
 *
 * THE THIRD FLIGHT is the point. Two draws are the two the app has always
 * kept ("winners", "consolation"); the third is the first filed under a word
 * of its own, and everything that read exactly two would pass a two-flight
 * test.
 */

type Entrant = { name: string; index: string };
const BY_HANDICAP = ["Alder", "Briar", "Cedar", "Dune", "Elm", "Fern", "Gorse", "Hazel", "Iris", "Juniper"];
// Entry order, deliberately not handicap order.
const ENTERED = ["Juniper", "Dune", "Hazel", "Alder", "Fern", "Briar", "Iris", "Elm", "Cedar", "Gorse"];
const FIELD: Entrant[] = ENTERED.map((first) => ({ name: `${first} Marsh`, index: String(BY_HANDICAP.indexOf(first) * 2) }));
const TOURNAMENT = "Club Match Play — In Flights";

test.beforeAll(async () => {
  const { session } = await seedOrganizer();
  process.env.ORGANIZER_SESSION = session;
});
test.afterAll(async () => {
  await teardownOrganizer();
});

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
}

/** A player's own phone, signed in as them. */
async function phoneOf(browser: Browser, testInfo: TestInfo, baseURL: string, first: string) {
  const i = ENTERED.indexOf(first);
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  await ctx.addCookies([{ name: "ng_session", value: await memberSession(medalEmail(i), `${first} Marsh`), url: baseURL }]);
  return ctx;
}

/** The flights panel's card for one flight, by the name on it. */
const flightCard = (page: Page, name: string) => page.locator("details").filter({ has: page.locator("summary", { hasText: name }) });

/** Show one flight's bracket. The tabs are a row of labelled radios. */
async function showFlight(page: Page, name: string) {
  await page.locator(".seg").getByText(name, { exact: true }).click();
  await expect(page.locator(".seg").getByRole("radio", { name, exact: true })).toBeChecked();
}

/** Decide a tie on the bracket on screen: the winner's name, then the margin. See `organizer-knockout.spec.ts`. */
async function decide(page: Page, winner: string, loser: string, round: "Semifinals" | "Final", margin: string) {
  const seats = page.getByRole("button", { name: new RegExp(`^${winner}`) });
  await (round === "Final" ? seats.last() : seats.first()).click();
  const pair = [winner, loser];
  const result = page.getByRole("textbox", { name: new RegExp(`^Result of (${pair.join("|")}) v (${pair.join("|")}), ${round}$`) });
  await expect(result, `no margin box for ${winner} v ${loser}`).toBeVisible({ timeout: 20_000 });
  await result.fill(margin);
  // Enter for a final, Tab for the rest: both keep the margin. Tab alone lost one on Firefox, where the
  // last box on a page has nowhere to send the focus (`organizer-knockout.spec.ts`, `leave-on-enter.ts`).
  await result.press(round === "Final" ? "Enter" : "Tab");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 20_000 });
}

test("a new organizer divides a field of ten into three flights and plays them to champions", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(480_000);
  await page.context().addCookies([{ name: "ng_session", value: process.env.ORGANIZER_SESSION!, url: baseURL! }]);
  const errors: string[] = [];
  watchPageErrors(page, errors);

  await test.step("a knockout, dated, with a field of ten and one bracket round", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A knockout/ }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

    await open(page, "/event");
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("Tournament dates, first day").fill(today);
    await page.getByLabel("Tournament dates, last day").fill(today);
    await page.getByRole("button", { name: "Save event" }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 20_000 });

    await open(page, "/registration");
    for (const [i, p] of FIELD.entries()) {
      await page.getByLabel("Player name", { exact: true }).fill(p.name);
      await page.getByRole("textbox", { name: /^Email · required/ }).fill(medalEmail(i));
      await page.getByRole("textbox", { name: /^Mobile · required/ }).fill(`55507${String(i).padStart(2, "0")}`);
      await page.getByLabel("Handicap", { exact: true }).fill(p.index);
      await page.getByRole("button", { name: "Add to field" }).click();
      await expect(page.getByText(p.name).first()).toBeVisible({ timeout: 20_000 });
    }
    // Everybody is IN, which a name on the screen does not say: the first draft of this entered
    // twelve, the free plan refused two, and the loop above passed on the name still in the box.
    await open(page, "/registration");
    for (const p of FIELD) await expect(page.locator("main").getByText(p.name).first(), `${p.name} is not in the field`).toBeVisible();

    await open(page, "/stages");
    await page.getByRole("button", { name: /^Bracket/ }).click();
    await page.getByLabel("Format for every round added").selectOption("Match Play");
    await page.getByRole("button", { name: /^Add bracket/ }).click();
    await expect(page.getByRole("button", { name: /^Round 1 · Bracket Stage/ })).toBeVisible({ timeout: 20_000 });
    // Pure knockouts, scratch: Gross, which a new round is not unless the
    // organizer chooses it (the club default since 2026-10-16). A net one needs a
    // course card before launch, and this walk's course has none.
    await playScratch(page, "Round 1 · Bracket Stage");
  });

  await test.step("arranged in several flights: nothing is drawn until the field is divided", async () => {
    await open(page, "/bracket");
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await page.getByRole("button", { name: /^Several flights/ }).click();
    await expect(page.getByRole("heading", { name: "Divide the field of 10" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Bracket manager/);
    await expect(page.getByText("Nothing is drawn until the field is divided into flights.")).toBeVisible();
    // No draw nobody made: not a tie, not a name, not a "TBD".
    await expect(page.getByRole("button", { name: /Marsh/ })).toHaveCount(0);
    await expect(page.getByText("TBD")).toHaveCount(0);
    // Ten is too few to suggest dividing, and the one shape offered says what it costs; a qualifying
    // score is not on offer with no qualifying round.
    await expect(page.getByText("One bracket of 10")).toBeVisible();
    await expect(page.getByText("6 byes")).toBeVisible();
    await expect(page.getByText("This knockout has no qualifying round before it.")).toBeVisible();

    await open(page, "/dashboard");
    const dash = await page.locator("main").innerText();
    expect(dash, `the dashboard lists a draw before there is one:\n${dash}`).toContain("The field is not divided into flights yet");
  });

  await test.step("divided by handicap into the organizer's own sizes", async () => {
    await open(page, "/bracket");
    await page.getByRole("radio", { name: "Your own sizes" }).check();
    const own = page.getByLabel("Players in each flight, top flight first, separated by commas");
    // Sizes that do not hold the field are answered before the button is.
    await own.fill("4, 3, 2");
    await expect(page.getByText("These add up to 9; the field is 10.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Divide the field" })).toBeDisabled();
    await own.fill("4, 3, 3");
    await expect(page.getByText("3 flights, 10 players.")).toBeVisible();
    await page.getByRole("button", { name: "Divide the field" }).click();
    await expect(page.getByRole("heading", { name: "3 flights · by handicap" })).toBeVisible({ timeout: 20_000 });

    for (const [name, firsts, shape] of [
      ["Championship flight", BY_HANDICAP.slice(0, 4), "4 players · bracket of 4 · no byes · 2 rounds"],
      ["First flight", BY_HANDICAP.slice(4, 7), "3 players · bracket of 4 · 1 bye · 2 rounds"],
      ["Second flight", BY_HANDICAP.slice(7, 10), "3 players · bracket of 4 · 1 bye · 2 rounds"],
    ] as const) {
      const card = flightCard(page, name);
      await expect(card.locator("summary")).toContainText(shape);
      await card.locator("summary").click();
      // In seed order: the lowest index first, not whoever entered first.
      await expect(card.locator("ol > li")).toHaveText(firsts.map((f) => new RegExp(`${f} Marsh`)));
    }
  });

  await test.step("a player moved up and back rejoins at the foot; a flight takes the club's own name", async () => {
    const mover = page.getByLabel("Move or add a player", { exact: true });
    const elm = await mover.locator("option", { hasText: "Elm Marsh" }).getAttribute("value");
    await mover.selectOption(elm!);
    await page.getByLabel("To flight", { exact: true }).selectOption({ label: "Championship flight" });
    await page.getByRole("button", { name: "Move", exact: true }).click();
    // Both brackets are resized, and the screen says what the move costs.
    await expect(flightCard(page, "Championship flight").locator("summary")).toContainText("5 players · bracket of 8 · 3 byes · 3 rounds", { timeout: 20_000 });
    await expect(flightCard(page, "First flight").locator("summary")).toContainText("2 players · bracket of 2 · no byes · 1 round");

    await mover.selectOption(elm!);
    await page.getByLabel("To flight", { exact: true }).selectOption({ label: "First flight" });
    await page.getByRole("button", { name: "Move", exact: true }).click();
    const first = flightCard(page, "First flight");
    await expect(first.locator("summary")).toContainText("3 players · bracket of 4 · 1 bye · 2 rounds", { timeout: 20_000 });
    // Placed by hand, so at the foot: Elm was its top seed — the bye was his — and is now its last.
    await expect(first.locator("ol > li")).toHaveText([/Fern Marsh/, /Gorse Marsh/, /Elm Marsh/]);

    await first.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("New name for First flight").fill("Seniors");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(flightCard(page, "Seniors").locator("summary")).toContainText("3 players", { timeout: 20_000 });
  });

  await test.step("launching locks the arrangement and leaves the division open", async () => {
    await open(page, "/dashboard");
    for (const step of ["Start taking entries", "Mark ready"]) {
      await page.getByRole("button", { name: step }).click();
      await expect(page.getByRole("button", { name: step })).toHaveCount(0, { timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Launch tournament" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
    await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });

    await open(page, "/bracket");
    await expect(page.getByText(/it is locked while setup is/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Change", exact: true })).toHaveCount(0);
    // The division is the draw: still the organizer's to adjust until somebody has played.
    await expect(page.getByRole("button", { name: "Start again" })).toBeVisible();
    await expect(page.getByLabel("Move or add a player", { exact: true })).toBeEnabled();
  });

  const juniperCtx = await phoneOf(browser, testInfo, baseURL!, "Juniper");
  const juniper = await juniperCtx.newPage();
  watchPageErrors(juniper, errors, "juniper");

  try {
    await test.step("a player in the third flight is told who they play, and in which flight", async () => {
      await open(juniper, "/me");
      await expect(juniper.getByText("Semifinal (Second flight) v Iris Marsh")).toBeVisible({ timeout: 20_000 });
    });

    await test.step("the Championship flight, with an upset, to its champion", async () => {
      await open(page, "/bracket");
      await showFlight(page, "Championship flight");
      await decide(page, "Dune Marsh", "Alder Marsh", "Semifinals", "2&1");
      // The first result fixes the flights, in every flight.
      await expect(page.getByText("Results are in, so the flights are fixed.")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Start again" })).toHaveCount(0);
      await decide(page, "Briar Marsh", "Cedar Marsh", "Semifinals", "4&3");
      await open(page, "/bracket");
      await showFlight(page, "Championship flight");
      await decide(page, "Dune Marsh", "Briar Marsh", "Final", "1 UP");
    });

    await test.step("the third flight to its champion; the middle one a single tie", async () => {
      await open(page, "/bracket");
      await showFlight(page, "Second flight");
      // Nobody from another flight is in this one, and nothing played above has landed here.
      const before = await page.locator("main").innerText();
      expect(before.slice(before.indexOf("Bracket manager")), "a result from another flight is on this one").not.toMatch(/2&1|4&3|1 UP/);
      // A flight of three: the top seed has the bye and is already in the final, waiting.
      const drawn = before.slice(before.indexOf("Bracket manager"));
      expect(drawn, `the third flight's bye is not its top seed's:\n${drawn}`).toMatch(/Hazel Marsh\s+1\s+Bye/);
      await decide(page, "Juniper Marsh", "Iris Marsh", "Semifinals", "19th");
      await open(page, "/bracket");
      await showFlight(page, "Second flight");
      await decide(page, "Juniper Marsh", "Hazel Marsh", "Final", "2 UP");

      await open(page, "/bracket");
      await showFlight(page, "Seniors");
      // Elm, moved by hand, is the last seed: no bye for him, and drawn against the second.
      await decide(page, "Elm Marsh", "Gorse Marsh", "Semifinals", "5&4");
    });

    await test.step("each flight keeps its own champion and its own results", async () => {
      for (const [flight, champion, margins, absent] of [
        ["Championship flight", "Dune Marsh", ["2&1", "4&3", "1 UP"], ["19th", "2 UP", "5&4"]],
        ["Second flight", "Juniper Marsh", ["19th", "2 UP"], ["2&1", "4&3", "1 UP", "5&4"]],
        ["Seniors", null, ["5&4"], ["2&1", "4&3", "1 UP", "19th", "2 UP"]],
      ] as const) {
        await open(page, "/bracket");
        await showFlight(page, flight);
        const text = await page.locator("main").innerText();
        const board = text.slice(text.indexOf("Bracket manager"));
        if (champion) expect(board, `${flight} has no champion:\n${board}`).toMatch(new RegExp(`CHAMPION[\\s\\S]{0,40}${champion}`, "i"));
        else expect(board, `${flight} names a champion with its final unplayed:\n${board}`).toMatch(/CHAMPION\s+TBD/i);
        const kept = await page.getByRole("textbox", { name: /^Result of / }).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
        for (const m of margins) expect(kept, `${flight}: the margin ${m} was not kept`).toContain(m);
        for (const m of absent) expect(kept, `${flight}: a margin from another flight (${m}) is on it`).not.toContain(m);
      }
    });

    await test.step("the dashboard: three flights, six of seven ties, two champions and a flight still playing", async () => {
      await open(page, "/dashboard");
      const dash = await page.locator("main").innerText();
      expect(dash, `the Players tile does not count the knockout's flights:\n${dash}`).toMatch(/Players\s+10\s+3 flights/i);
      // A draw of n players is n − 1 ties, a bye being nobody's: 3 + 2 + 2, of which 3 + 1 + 2 are played.
      expect(dash, `ties are not counted across every flight:\n${dash}`).toMatch(/6\/7/);
      const tile = dash.slice(dash.indexOf("Bracket status"), dash.indexOf("Open the bracket"));
      expect(tile, `the bracket tile:\n${tile}`).toContain("3 flights, each its own knockout");
      expect(tile).toMatch(/Championship flight\s+Dune Marsh/);
      expect(tile).toMatch(/Second flight\s+Juniper Marsh/);
      // The middle flight has no champion and says so by counting, under the name the club gave it.
      expect(tile).toMatch(/Seniors\s+2 matches/);
      expect(tile).not.toMatch(/First flight|Consolation|Plate|Main draw/);
    });

    await test.step("the third flight's champion reads it on their own phone", async () => {
      await open(juniper, "/me/board");
      const board = await juniper.locator("main").innerText();
      const mine = board.slice(board.toUpperCase().indexOf("SECOND FLIGHT"));
      expect(mine, `the player's board has no third flight:\n${board}`).toMatch(/CHAMPION[\s\S]{0,40}Juniper Marsh/i);
    });
  } finally {
    await juniperCtx.close();
  }

  expect(errors, "a screen threw").toEqual([]);
});
