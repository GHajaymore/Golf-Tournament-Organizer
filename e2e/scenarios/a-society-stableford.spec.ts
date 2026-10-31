import { test, expect, type Page, type BrowserContext } from "../coverage";
import { appendFileSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { seed, setPlanFor, names, indexes, memberSession, eventFacts, rng, card, MARK, COURSE, COURSE_CITY, becomesEnabled } from "./kit.mjs";

/**
 * SCENARIO — tournament A: a community golf society on Birdie ($49),
 * "Saturday Stableford". 110 members on the roster, a field capped at 50 by
 * the plan; members enter themselves from their phones. Net Stableford, 95%.
 * Kept in the dev database afterwards (Ajay, 2026-10-09).
 */
const PHASE = process.env.PHASE ?? "A1";
const OUT = process.env.PROBE_DIR!;
const LOG = () => join(OUT, `five-${PHASE}.txt`);
export const A_NAME = `${MARK} Saturday Stableford${process.env.RUN ? ` ${process.env.RUN}` : ""}`;
export const ROSTER = 110;
const ORG_EMAIL = `${MARK}-community@example.invalid`;
// Different names from the club's — a society is its own membership.
const OFFSET = 200;

// A control that never becomes usable fails in under a minute.
test.use({ actionTimeout: 45_000, navigationTimeout: 60_000 });

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(LOG(), "");
});

async function open(page: Page, path: string) {
  const res = await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
  return res;
}

async function read(page: Page, path: string, name: string, chars = 3000) {
  const res = await open(page, path);
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  appendFileSync(LOG(), `\n## ${name} [${res?.status()} → ${new URL(page.url()).pathname}] sideways=${wide}\n${text.slice(0, chars)}\n`);
  await page.screenshot({ path: join(OUT, `five-${PHASE}-${name}.png`), fullPage: false });
}

const note = (s: string) => appendFileSync(LOG(), `\n# ${s}\n`);

async function as(context: BrowserContext, baseURL: string, session: string) {
  await context.clearCookies();
  await context.addCookies([{ name: "ng_session", value: session, url: baseURL }]);
}

export const memberEmail = (i: number) => `${MARK}-a-${String(i).padStart(3, "0")}@example.invalid`;

test("five A", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== (process.env.PROJECT ?? "desktop"), "one project");
  test.setTimeout(Number(process.env.PHASE_TIMEOUT ?? 900_000));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));
  const s = await seed();
  await as(context, baseURL!, s.community);

  if (PHASE === "A1") {
    await test.step("the society's organizer creates the Saturday Stableford", async () => {
      await open(page, "/choose");
      if (await eventFacts(A_NAME)) {
        note("this run's tournament already exists — resuming");
        await open(page, "/dashboard");
      } else if (await page.getByLabel("Tournament name").count()) {
        await page.getByLabel("Tournament name").fill(A_NAME);
        await page.getByRole("button", { name: /^A single round/ }).click();
        await page.getByRole("button", { name: "Create tournament" }).click();
      } else {
        note("next tournament: created from /tournaments");
        await open(page, "/tournaments");
        await page.getByLabel("Create a new tournament").fill(A_NAME);
        const shape = page.getByLabel("How is it played?");
        if (await shape.count()) await shape.selectOption({ label: "A single round" });
        await page.getByRole("button", { name: /Create tournament/ }).click();
      }
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
      await read(page, "/dashboard", "dashboard-new", 1500);
    });

    await test.step("the owner moves the society onto Birdie", async () => {
      await setPlanFor(ORG_EMAIL, "society");
    });

    await test.step("name the society and say what it is", async () => {
      await open(page, "/organization");
      // The community kind, labelled in the club's country's words: "League or association"
      // with no country (the app's US default since 2026-10-24), "Society or league" in Britain.
      await page.locator("label", { hasText: /Society or league|League or association/ }).first().click();
      await page.waitForTimeout(1500);
      await page.getByLabel("Organization name").fill(`${MARK} Fairway Friends Golf Society`);
      const save = page.getByRole("button", { name: "Save changes" }).first();
      // Named on an earlier pass: Save is rightly disabled with nothing changed.
      if (await becomesEnabled(save)) await save.click();
      else note("society already named — nothing to save");
      await page.waitForTimeout(2000);
      await read(page, "/organization", "organization", 1200);
    });

    await test.step("the roster: 110 members from the society's spreadsheet", async () => {
      const field = names(ROSTER, OFFSET);
      const idx = indexes(ROSTER, 23);
      const csv = [
        "name,handicap,email,phone",
        ...field.map((n, i) => `${n},${idx[i]},${memberEmail(i)},55502${String(i).padStart(4, "0")}`),
      ].join("\n");
      await open(page, "/roster");
      await page.locator('input[type="file"][accept*=".csv"]').first().setInputFiles({
        name: "members.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
      await page.waitForTimeout(5000);
      await read(page, "/roster", "roster", 2500);
    });

    await test.step("date, course, and one Stableford round", async () => {
      await open(page, "/event");
      const sat = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      await page.getByLabel("Tournament dates, first day").fill(sat);
      await page.getByLabel("Tournament dates, last day").fill(sat);
      const course = page.getByRole("combobox", { name: "Golf course" });
      await course.click();
      await course.fill(COURSE);
      await page.locator('#course-picker-list [role="option"]', { hasText: COURSE_CITY }).first().click();
      await page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ }).click();
      await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 30_000 });
      await read(page, "/event", "event", 2500);

      await open(page, "/stages");
      await page.getByRole("button", { name: /^Stroke play round/ }).click();
      await page.getByLabel("Format for every round added").selectOption("Stableford");
      await page.getByRole("button", { name: /^Add stroke play round|^Add 1 stroke play round/ }).click();
      await page.waitForTimeout(2500);
      await read(page, "/stages", "stages", 4500);
    });

    await test.step("open entries to the society", async () => {
      await read(page, "/registration", "registration", 3000);
      await read(page, "/dashboard", "dashboard-setup", 3000);
    });
  }

  if (PHASE === "A2") {
    await test.step("the secretary opens Entries", async () => {
      await open(page, "/dashboard");
      await read(page, "/registration", "registration-open", 2500);
    });

    await test.step("a rostered member, signed in, looks for it (the roster is not membership)", async () => {
      const field = names(ROSTER, OFFSET);
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(memberEmail(0), field[0]), url: baseURL! }]);
      const p = await phone.newPage();
      await open(p, "/me/events");
      note(`member 1 signed in sees: ${(await p.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 260)}`);
      await phone.close();
    });

    await test.step("the secretary publishes the sign-up link", async () => {
      await open(page, "/registration");
      await page.getByRole("button", { name: /Let players sign themselves up/ }).click();
      const publish = page.getByRole("button", { name: /Publish the link/ });
      if (await publish.count()) {
        await publish.click();
        await expect(page.getByRole("button", { name: /Take the link down/ })).toBeVisible({ timeout: 20_000 });
      }
      await read(page, "/registration", "registration-link", 2500);
    });

    await test.step("sixty members sign up through the link, on their phones", async () => {
      const field = names(ROSTER, OFFSET);
      const idx = indexes(ROSTER, 23);
      const token = (await eventFacts(A_NAME))!.registrationToken;
      note(`sign-up token present: ${!!token}`);
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`signup ${new URL(p.url()).pathname}: ${String(e)}`));
      const tally: Record<string, number> = {};
      for (let i = 0; i < 60; i += 1) {
        await phone.clearCookies();
        await open(p, `/register/${token}`);
        await p.getByLabel("Your name").fill(field[i]);
        await p.getByLabel("Email").fill(memberEmail(i));
        const hcp = p.getByLabel("Handicap index");
        if (await hcp.count()) await hcp.fill(String(idx[i]));
        const phoneBox = p.getByLabel(/^Phone/);
        if (await phoneBox.count()) await phoneBox.fill(`55502${String(i).padStart(4, "0")}`);
        const go = p.getByRole("button", { name: /^(Register|Join the waitlist)$/ });
        const label = ((await go.textContent()) ?? "").trim();
        await go.click();
        // The outcome, or a refusal — whichever the screen says, up to 15s.
        await p
          .getByText(/You're in!|You’re in!|on the waitlist|already|couldn't|could not|went wrong|try again/i)
          .first()
          .waitFor({ timeout: 15_000 })
          .catch(async () => {
            const now = ((await go.textContent().catch(() => "")) ?? "").trim();
            const err = (await p.locator(".form-error, [role=alert]").allInnerTexts()).join(" | ");
            note(`signup ${i + 1}: NO OUTCOME after 15s — button reads "${now}", errors: "${err}"`);
          });
        const words = (await p.locator("main").innerText()).replace(/\s+/g, " ");
        const outcome = /wait/i.test(words) && !/^Register/.test(label) ? "waitlisted" : /wait.?list/i.test(words) ? "waitlisted" : /registered|you.re in|confirmed/i.test(words) ? "in" : "other";
        tally[`${label} → ${outcome}`] = (tally[`${label} → ${outcome}`] ?? 0) + 1;
        if (i === 0 || i === 49 || i === 50 || i === 59 || outcome === "other") note(`signup ${i + 1} ${field[i]}: "${label}" → ${outcome === "other" ? words : words.slice(0, 260)}`);
      }
      note(`tally: ${JSON.stringify(tally)}`);
      await phone.close();
      const facts = await eventFacts(A_NAME);
      const by: Record<string, number> = {};
      for (const pl of facts!.players) by[pl.status] = (by[pl.status] ?? 0) + 1;
      note(`players by status: ${JSON.stringify(by)}`);
    });

    await test.step("what the secretary and two members read", async () => {
      await read(page, "/registration", "registration-full", 3000);
      await read(page, "/dashboard", "dashboard-full", 2500);
      const field = names(ROSTER, OFFSET);
      for (const i of [10, 55]) {
        const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
        await phone.addCookies([{ name: "ng_session", value: await memberSession(memberEmail(i), field[i]), url: baseURL! }]);
        const p = await phone.newPage();
        p.on("pageerror", (e) => errors.push(`member ${i} ${new URL(p.url()).pathname}: ${String(e)}`));
        await read(p, "/me", `member-${i + 1}-today`, 1200);
        await read(p, "/me/events", `member-${i + 1}-events`, 1200);
        await phone.close();
      }
    });
  }

  if (PHASE === "A3") {
    const field = names(ROSTER, OFFSET);
    const statusOf = async (i: number) => (await eventFacts(A_NAME))!.players.find((p) => p.email === memberEmail(i))?.status;
    await test.step("a confirmed member can't make it, and withdraws from their phone", async () => {
      note(`before: member 6 ${await statusOf(5)}, member 51 ${await statusOf(50)}, member 52 ${await statusOf(51)}`);
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(memberEmail(5), field[5]), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`member 6 ${new URL(p.url()).pathname}: ${String(e)}`));
      await open(p, "/me/events");
      await p.getByRole("button", { name: /Can.t make it\? Withdraw/ }).first().click();
      const ask = p.getByRole("group", { name: /^Withdraw from / });
      note(`withdraw asks: ${(await ask.innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
      await ask.getByRole("button", { name: /^Withdraw$/ }).click();
      await p.waitForTimeout(2500);
      await read(p, "/me", "withdrawn-today", 900);
      await phone.close();
      note(`after: member 6 ${await statusOf(5)}, member 51 ${await statusOf(50)}, member 52 ${await statusOf(51)}`);
    });
    await test.step("the first on the waiting list, on their phone", async () => {
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(memberEmail(50), field[50]), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`member 51 ${new URL(p.url()).pathname}: ${String(e)}`));
      await read(p, "/me", "promoted-today", 900);
      await read(p, "/me/events", "promoted-events", 900);
      await phone.close();
    });
    await test.step("what the secretary sees", async () => {
      await read(page, "/registration", "registration-after-withdrawal", 2500);
    });
  }

  if (PHASE === "A4") {
    await test.step("two handicap divisions", async () => {
      await open(page, "/grouping");
      await page.getByRole("button", { name: /Handicap divisions/ }).click();
      await page.locator("label.seg-opt", { hasText: "Set flights" }).click();
      await page.locator("input.input").last().fill("2");
      await page.getByRole("button", { name: /Generate flights/ }).click();
      await page.waitForTimeout(3000);
      await read(page, "/grouping", "divisions", 2500);
    });
    await test.step("prizes: top three, each division's winner, nearest the pin and longest drive", async () => {
      await open(page, "/prizes");
      for (const b of ["Top 3 overall", "Flight winners", "Nearest the pin & longest drive"]) {
        await page.getByRole("button", { name: b }).click();
        await page.waitForTimeout(1500);
      }
      await read(page, "/prizes", "prizes", 2500);
    });
    await test.step("launch, and the board public", async () => {
      await open(page, "/dashboard");
      await page.getByRole("button", { name: "Launch tournament" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
      await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
      await open(page, "/event");
      await page.locator("label", { hasText: "Anyone with the link" }).first().click();
      await page.getByRole("button", { name: /^Save/ }).last().click();
      await page.waitForTimeout(2500);
      const facts = await eventFacts(A_NAME);
      note(`public board: ${(await page.request.get(`/live/${facts!.shareToken}`)).status()}`);
    });
    await test.step("a shotgun start, fourballs", async () => {
      await open(page, "/foursomes");
      await page.getByRole("button", { name: /^Balanced handicap/ }).click();
      await page.locator("label.seg-opt", { hasText: /^\s*4\s*$/ }).click();
      const shotgun = page.locator("label.seg-opt", { hasText: /^\s*Shotgun\s*$/ });
      note(`shotgun option: ${await shotgun.count()}`);
      if (await shotgun.count()) await shotgun.click();
      const first = page.getByLabel(/First tee|Start time|Shotgun at/).first();
      if (await first.count()) await first.fill("09:00");
      await page.getByRole("button", { name: /^Save & publish/ }).click();
      await page.getByRole("button", { name: "Publish the tee sheet" }).click();
      await page.waitForTimeout(3000);
      await read(page, "/foursomes", "teesheet", 3000);
      await read(page, "/dashboard", "dashboard-launched", 3000);
    });
  }

  if (PHASE === "A5") {
    const field = names(ROSTER, OFFSET);
    const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
    const facts = await eventFacts(A_NAME);
    const kit = facts!.players.find((p) => p.name === "Kit Fernleigh")!;
    await test.step("Kit, off the 3rd in the shotgun, keeps her own Stableford card", async () => {
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(kit.email, kit.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`Kit ${new URL(p.url()).pathname}: ${String(e)}`));
      await read(p, "/me", "kit-today", 1200);
      await open(p, "/me/card");
      const opensOn = await p.getByRole("textbox", { name: /^Strokes on hole \d+/ }).getAttribute("aria-label").catch(() => "none");
      const heading = (await p.locator("main").innerText()).match(/HOLE \d+/)?.[0];
      note(`Kit's card opens on: ${heading} (${opensOn})`);
      // Off the 3rd: 3..18, then 1 and 2. A net double bogey on the 8th — Stableford, she'd pick up.
      for (const h of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2]) {
        await p.getByRole("button", { name: new RegExp(`^Hole ${h},`) }).click();
        const s = h === 8 ? PAR[h - 1] + 4 : h % 3 === 0 ? PAR[h - 1] : PAR[h - 1] + 1;
        await p.getByRole("textbox", { name: `Strokes on hole ${h}` }).fill(String(s));
        await expect(p.getByRole("button", { name: `Hole ${h}, not scored` })).toHaveCount(0);
      }
      await p.waitForTimeout(1500);
      await open(p, "/me/card");
      const main = (await p.locator("main").innerText()).replace(/\s+/g, " ");
      note(`Kit's card after 18: ${main.slice(0, 400)}`);
      const certify = p.getByRole("button", { name: /Certify my card/ });
      if (await certify.count()) {
        await certify.click();
        await p.waitForTimeout(2000);
      }
      await read(p, "/me", "kit-today-after", 1200);
      await read(p, "/me/board", "kit-board", 1500);
      await phone.close();
    });
    await test.step("the secretary imports everybody else's card", async () => {
      const r = rng(31);
      const rows = facts!.players
        .filter((p) => p.status === "confirmed" && p.id !== kit.id)
        .map((p) => `${p.name},${card(Math.round((p.handicap * 128) / 113 - 0.2), r).join(",")}`);
      const csv = ["Player," + Array.from({ length: 18 }, (_, i) => i + 1).join(","), ...rows].join("\n");
      await open(page, "/entry");
      await page.getByRole("button", { name: /Import scores/ }).click();
      await page.locator("textarea").first().fill(csv);
      await page.waitForTimeout(800);
      const go = page.getByRole("button", { name: /^Import \d+ rows?/ });
      note(`import button: ${(await go.textContent())?.trim()}`);
      await go.click();
      await expect(page.getByText(/Imported \d+ row/)).toBeVisible({ timeout: 120_000 });
      note(`import said: ${(await page.getByText(/Imported \d+ row/).first().textContent())?.trim()}`);
      await read(page, "/leaderboard", "board", 3500);
      await read(page, "/dashboard", "dashboard-cards-in", 2500);
    });
  }

  if (PHASE === "A6") {
    await test.step("the committee approves every card", async () => {
      await open(page, "/entry");
      const clean = page.getByRole("button", { name: /^Approve \d+ clean card/ });
      if (await clean.count() && (await clean.isEnabled())) {
        note(`clean: ${(await clean.textContent())?.trim()}`);
        await clean.click();
        await page.waitForTimeout(2500);
      }
      const panel = page.locator(".card", { hasText: "Approve this round" }).first();
      const anyway = panel.getByRole("button", { name: "Approve anyway" });
      const t = Date.now();
      let n = 0;
      for (let left = await anyway.count(); left > 0; left -= 1) {
        await anyway.first().click();
        await expect(anyway).toHaveCount(left - 1, { timeout: 20_000 });
        n += 1;
      }
      note(`approved ${n} one by one in ${Math.round((Date.now() - t) / 1000)}s`);
    });
    await test.step("close the round, complete the day", async () => {
      await open(page, "/dashboard");
      const ready = page.getByRole("region", { name: "The round is ready to close" });
      note(`ready-to-close: ${await ready.count()}`);
      if (await ready.count()) {
        await ready.getByRole("button", { name: /^Close / }).click();
        await ready.getByRole("button", { name: /Close the round/ }).click();
        await page.waitForTimeout(3000);
      }
      // Complete asks first (2026-10-10), and a completed tournament can be
      // reopened: complete, reopen, complete again — each confirmed.
      const settle = async (button: string, want: string) => {
        await page.getByRole("button", { name: button }).first().click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toBeVisible({ timeout: 15_000 });
        note(`${button} dialog: ${(await dialog.innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
        await dialog.getByRole("button", { name: button }).click();
        await expect.poll(async () => (await eventFacts(A_NAME))!.status, { timeout: 20_000 }).toBe(want);
        await page.waitForTimeout(1500);
        note(`status after ${button}: ${want}`);
      };
      await settle("Complete tournament", "completed");
      await settle("Reopen tournament", "live");
      await settle("Complete tournament", "completed");
    });
    await test.step("prizes, as the society would award them", async () => {
      await open(page, "/prizes");
      const picks = page.getByRole("combobox", { name: /^Winner of / });
      const n = await picks.count();
      const taken = new Set<string>();
      for (let i = 0; i < n; i += 1) {
        const pick = page.getByRole("combobox", { name: /^Winner of / }).nth(i);
        const label = (await pick.getAttribute("aria-label")) ?? "";
        const options = await pick.locator("option").evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? "" })));
        // Nearest the pin and longest drive are marked on the course, not ranked: the society picks somebody.
        const skill = /nearest|longest/i.test(label);
        const choice = skill ? options.filter((o) => o.v && !taken.has(o.v))[7] : options.find((o) => o.v && !taken.has(o.v));
        note(`${label}: offered ${options.slice(1, 4).map((o) => o.t.trim()).join(" | ")} -> ${choice?.t.trim()}`);
        if (!choice) continue;
        taken.add(choice.v);
        await pick.selectOption(choice.v);
        await page.waitForTimeout(1500);
      }
      await read(page, "/prizes", "prizes-awarded", 2500);
    });
    await test.step("the result: the society, the public board, two members", async () => {
      await read(page, "/leaderboard", "board-final", 3000);
      await read(page, "/reports", "reports", 2500);
      const facts = await eventFacts(A_NAME);
      await read(page, `/live/${facts!.shareToken}`, "live-final", 3000);
      for (const name of ["Kit Fernleigh", "Gwilym Fernleigh"]) {
        const who = facts!.players.find((p) => p.name === name)!;
        const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
        await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
        const p = await phone.newPage();
        p.on("pageerror", (e) => errors.push(`${name} ${new URL(p.url()).pathname}: ${String(e)}`));
        await read(p, "/me", `${name.split(" ")[0]}-final`, 1200);
        await read(p, "/me/board", `${name.split(" ")[0]}-board-final`, 800);
        await phone.close();
      }
    });
  }

  if (PHASE === "A7") {
    await test.step("a rostered member who never entered still sees the society's day", async () => {
      // Since 2026-10-10 the roster IS membership: an active roster row,
      // matched by email, opens the club's calendar.
      const field = names(ROSTER, OFFSET);
      const i = ROSTER - 1;
      const facts = (await eventFacts(A_NAME))!;
      const entered = facts.players.some((x) => x.email === memberEmail(i));
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(memberEmail(i), field[i]), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`rostered ${new URL(p.url()).pathname}: ${String(e)}`));
      await open(p, "/me/events");
      const seen = (await p.locator("article", { hasText: A_NAME }).count()) > 0;
      note(`member ${i + 1} (entered: ${entered}) sees ${A_NAME}: ${seen}`);
      if (!seen) note("ROSTER MEMBER CANNOT SEE THE SOCIETY'S EVENT");
      await phone.close();
    });
  }

  appendFileSync(LOG(), `\n# page errors: ${errors.length}\n${errors.join("\n")}\n`);
});

export { names, indexes, memberSession, eventFacts };
