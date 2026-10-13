import { test, expect, type Page, type BrowserContext } from "../coverage";
import { appendFileSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { seed, setPlanFor, names, indexes, memberSession, eventFacts, roundCards, rng, card, MARK, COURSE, COURSE_CITY } from "./kit.mjs";

/**
 * SCENARIO — tournament C: a 36-hole Club Championship at an Eagle
 * club, 120 players, gross, cut to the top 40 and ties, three handicap
 * flights. Run in PHASES (env PHASE) against a built server; the event lives
 * in the development database between phases and is torn down at the end.
 */
const PHASE = process.env.PHASE ?? "C1";
const OUT = process.env.PROBE_DIR!;
const LOG = () => join(OUT, `five-${PHASE}.txt`);
export const C_NAME = `${MARK} Club Championship${process.env.RUN ? ` ${process.env.RUN}` : ""}`;
export const C_FIELD = 120;
const CLUB_EMAIL = `${MARK}-club@example.invalid`;

// A control that never becomes usable fails in under a minute, not at the phase's end.
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

/** Read a screen into the log: status, sideways scroll, and its text. */
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

test("five", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== (process.env.PROJECT ?? "desktop"), "one project");
  test.setTimeout(Number(process.env.PHASE_TIMEOUT ?? 900_000));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));

  if (PHASE === "C1") {
    const s = await seed();
    writeFileSync(join(OUT, "sessions.json"), JSON.stringify(s));
    await as(context, baseURL!, s.club);

    await test.step("a new secretary creates the championship", async () => {
      await open(page, "/choose");
      if (await page.getByLabel("Tournament name").count()) {
        await page.getByLabel("Tournament name").fill(C_NAME);
        await page.getByRole("button", { name: /^A series of rounds/ }).click();
        await page.getByRole("button", { name: "Create tournament" }).click();
      } else {
        // A club's NEXT tournament: /choose hands an organizer with one
        // straight to the dashboard, and the Tournaments screen creates it.
        note("second tournament: created from /tournaments");
        await open(page, "/tournaments");
        await page.getByLabel("Create a new tournament").fill(C_NAME);
        const shape = page.getByLabel("How is it played?");
        if (await shape.count()) await shape.selectOption({ label: "A series of rounds" });
        await page.getByRole("button", { name: /Create tournament/ }).click();
      }
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
      await read(page, "/dashboard", "dashboard-new");
    });

    await test.step("the owner moves the club onto Eagle", async () => {
      await setPlanFor(CLUB_EMAIL, "club");
    });

    await test.step("name the club", async () => {
      await read(page, "/organization", "organization");
    });

    await test.step("date and course", async () => {
      await open(page, "/event");
      const today = new Date().toISOString().slice(0, 10);
      const next = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      await page.getByLabel("Tournament dates, first day").fill(today);
      await page.getByLabel("Tournament dates, last day").fill(next);
      const course = page.getByRole("combobox", { name: "Golf course" });
      await course.click();
      await course.fill(COURSE);
      await page.locator('#course-picker-list [role="option"]', { hasText: COURSE_CITY }).first().click();
      await page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ }).click();
      await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 30_000 });
      await read(page, "/event", "event");
    });

    await test.step("import the field: 120 members from the club system", async () => {
      const field = names(C_FIELD);
      const idx = indexes(C_FIELD, 7);
      const csv = [
        "name,handicap,email,phone",
        ...field.map((n, i) => `${n},${idx[i]},${MARK}-c-${String(i).padStart(3, "0")}@example.invalid,55501${String(i).padStart(4, "0")}`),
      ].join("\n");
      await open(page, "/registration");
      await page.locator('input[type="file"][accept*=".csv"]').first().setInputFiles({
        name: "members.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
      await expect(page.getByText(/Imported \d+/)).toBeVisible({ timeout: 60_000 });
      await read(page, "/registration", "registration-imported", 4000);
    });

    await test.step("two rounds of stroke play, cut to the top 40 and ties", async () => {
      await open(page, "/stages");
      await page.getByRole("button", { name: /^Stroke play round/ }).click();
      await page.getByLabel("How many rounds to add").fill("2");
      await page.getByLabel("Format for every round added").selectOption("Stroke Play");
      await page.getByRole("button", { name: /^Add 2 stroke play rounds/ }).click();
      await expect(page.getByRole("button", { name: /^Round 2 · Stroke Play Round/ })).toBeVisible({ timeout: 20_000 });
      const cutBox = page.getByRole("checkbox", { name: "Cut the field for Round 2" });
      await cutBox.check();
      const n = page.getByLabel("Players who make the cut for Round 2");
      await n.fill("40");
      await n.press("Tab");
      await page.waitForTimeout(1500);
      await read(page, "/stages", "stages", 4000);
    });

    await test.step("three flights by handicap", async () => {
      await open(page, "/grouping");
      await page.getByRole("button", { name: /Handicap divisions/ }).click();
      await page.locator("label.seg-opt", { hasText: "Set flights" }).click();
      const count = page.locator("input.input").last();
      await count.fill("3");
      await page.getByRole("button", { name: /Generate flights/ }).click();
      await page.waitForTimeout(3000);
      await read(page, "/grouping", "flights", 3000);
    });

    await test.step("prizes: top three, and each flight's winner", async () => {
      await open(page, "/prizes");
      await page.getByRole("button", { name: "Top 3 overall" }).click();
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Flight winners" }).click();
      await page.waitForTimeout(1500);
      await read(page, "/prizes", "prizes", 4000);
    });

    await test.step("make the board public and launch", async () => {
      await read(page, "/dashboard", "dashboard-before-launch", 4000);
      for (const step of ["Start taking entries", "Mark ready"]) {
        const b = page.getByRole("button", { name: step });
        if (await b.count()) {
          await b.click();
          await expect(b).toHaveCount(0, { timeout: 20_000 });
        }
      }
      await page.getByRole("button", { name: "Launch tournament" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
      await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
    });

    await test.step("members' families follow the board: anyone with the link", async () => {
      await open(page, "/event");
      await page.locator("label", { hasText: "Anyone with the link" }).first().click();
      await page.getByRole("button", { name: /^Save/ }).last().click();
      await page.waitForTimeout(2500);
      const facts = await eventFacts(C_NAME);
      const res = await page.request.get(`/live/${facts!.shareToken}`);
      note(`public board after making it public: ${res.status()}`);
    });

    await test.step("the Round 1 tee sheet: fourballs, two tees, balanced", async () => {
      await open(page, "/foursomes");
      await page.getByRole("button", { name: /^Balanced handicap/ }).click();
      await page.locator("label.seg-opt", { hasText: /^\s*4\s*$/ }).click();
      await page.locator("label.seg-opt", { hasText: /^\s*Split\s*$/ }).click();
      await page.getByLabel("First tee").fill("07:00");
      await page.getByRole("button", { name: /^Save & publish/ }).click();
      await page.getByRole("button", { name: "Publish the tee sheet" }).click();
      await page.waitForTimeout(3000);
      await read(page, "/foursomes", "teesheet", 3000);
      await read(page, "/dashboard", "dashboard-launched", 4000);
    });
  }

  if (PHASE === "C2a") {
    const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
    await as(context, baseURL!, s.club);

    await test.step("the secretary names the club and says it is one", async () => {
      await open(page, "/organization");
      await page.locator("label", { hasText: "Golf club" }).first().click();
      await page.waitForTimeout(1500);
      const name = page.getByLabel("Organization name");
      await name.fill(`${MARK} Royal Oakridge Golf Club`);
      const save = page.getByRole("button", { name: "Save changes" }).first();
      // Already named on an earlier pass: Save is rightly disabled with nothing changed.
      if (await save.isEnabled()) await save.click();
      else note("club already named — nothing to save");
      await page.waitForTimeout(2000);
      await read(page, "/organization", "organization-named", 1500);
      await read(page, "/dashboard", "dashboard-club", 1500);
    });

    // Two members, on their phones, the morning of Round 1.
    const facts = await eventFacts(C_NAME);
    for (const who of [facts!.players.find((p) => p.name === "Faye Brackenbury")!, facts!.players.find((p) => p.name === "Delphine Ashgrove")!]) {
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`member ${new URL(p.url()).pathname}: ${String(e)}`));
      note(`MEMBER ${who.name} (${who.handicap})`);
      for (const [path, n] of [["/me", "me"], ["/me/card", "me-card"], ["/me/board", "me-board"], ["/me/events", "me-events"]] as const) {
        await read(p, path, `${who.name.split(" ")[0]}-${n}`, 1800);
      }
      await phone.close();
    }
  }

  if (PHASE === "dbg") {
    const facts = await eventFacts(C_NAME);
    const who = facts!.players.find((p) => p.name === "Faye Brackenbury")!;
    const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
    await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
    const p = await phone.newPage();
    await open(p, "/me/card");
    const names = await p.getByRole("button").evaluateAll((els) =>
      els.map((e) => `${(e.getAttribute("aria-label") ?? "").slice(0, 60)} | ${(e as HTMLElement).innerText.replace(/\s+/g, " ").slice(0, 40)}`),
    );
    appendFileSync(LOG(), names.join("\n"));
    const complete = await p.locator('[aria-label*="complete"]').count();
    const labels = await p.locator("[aria-label]").evaluateAll((els) => els.slice(0, 40).map((e) => e.getAttribute("aria-label")));
    appendFileSync(LOG(), `\ncomplete=${complete}\n${labels.join("\n")}`);
    await phone.close();
  }

  if (PHASE === "C2b") {
    const facts = await eventFacts(C_NAME);
    const member = async (name: string) => {
      const who = facts!.players.find((p) => p.name === name)!;
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`${name} ${new URL(p.url()).pathname}: ${String(e)}`));
      return { p, phone, who };
    };

    await test.step("Faye keeps her own card, hole by hole, and signs it", async () => {
      const { p, phone } = await member("Faye Brackenbury");
      await open(p, "/me/card");
      // Par golf with a birdie on 4 and a bogey on 7: 71.
      const strokes = [4, 4, 3, 4, 4, 4, 4, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
      const t0 = Date.now();
      const at = () => `${Date.now() - t0}ms`;
      p.on("request", (r) => {
        if (r.method() === "POST") note(`${at()} POST ${(r.postData() || "").replace(/"cmv[^"]+"/g, "id").slice(7, 100)}`);
      });
      p.on("response", (r) => { if (r.request().method() === "POST") note(`${at()} RES ${r.status()}`); });
      p.on("framenavigated", (f) => { if (f === p.mainFrame()) note(`${at()} NAV`); });
      p.on("console", (m) => { if (m.type() === "error") note(`${at()} CONSOLE ${m.text().slice(0, 200)}`); });
      const strip = async () =>
        (await p.getByRole("button", { name: /^Hole \d+,/ }).evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label")!.includes("complete") ? "x" : ".")).join("")));
      for (const [i, s] of strokes.entries()) {
        await p.getByRole("button", { name: new RegExp(`^Hole ${i + 1},`) }).click();
        await p.getByRole("textbox", { name: `Strokes on hole ${i + 1}` }).fill(String(s));
        await expect(p.getByRole("button", { name: `Hole ${i + 1}, not scored` })).toHaveCount(0, { timeout: 15_000 });
        note(`${at()} h${i + 1}=${s} ${await strip()}`);
      }
      await p.waitForTimeout(2000);
      await read(p, "/me/card", "faye-card-full", 1800);
      const certify = p.getByRole("button", { name: /Certify my card/ });
      note(`certify button: ${await certify.count()}`);
      if (await certify.count()) {
        await certify.click();
        await p.waitForTimeout(2500);
      }
      await read(p, "/me/card", "faye-card-certified", 1800);
      await read(p, "/me", "faye-today-after", 1800);
      await phone.close();
    });

    await test.step("Delphine opens the group's cards", async () => {
      const { p, phone } = await member("Delphine Ashgrove");
      await open(p, "/me/card");
      await p.getByText("Group (4)", { exact: true }).click();
      await p.waitForTimeout(1500);
      const text = (await p.locator("main").innerText()).replace(/\s+/g, " ");
      appendFileSync(LOG(), `\n## delphine-group-view\n${text.slice(0, 2500)}\n`);
      await p.screenshot({ path: join(OUT, `five-C2b-delphine-group.png`), fullPage: false });
      await phone.close();
    });

    await test.step("a Group 2 member, off the 10th", async () => {
      const { p, phone } = await member("Gwilym Brackenbury");
      await read(p, "/me", "gwilym-today", 1200);
      await read(p, "/me/card", "gwilym-card", 900);
      await phone.close();
    });

    await test.step("the secretary's view of it", async () => {
      const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
      await as(context, baseURL!, s.club);
      await read(page, "/entry", "entry", 2500);
      await read(page, "/leaderboard", "board", 1500);
    });
  }

  if (PHASE === "C2c") {
    const facts = await eventFacts(C_NAME);
    const member = async (name: string) => {
      const who = facts!.players.find((p) => p.name === name)!;
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`${name} ${new URL(p.url()).pathname}: ${String(e)}`));
      return { p, phone, who };
    };
    const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
    // Delphine (29.9) mostly double bogeys; Odile (18.4) bogey golf with a
    // par every third hole; Jasper (18.7) bogeys with a birdie on the 12th.
    const cards: Record<string, number[]> = {
      "Delphine Ashgrove": PAR.map((p, i) => p + (i % 4 === 0 ? 1 : 2)),
      "Odile Ashgrove": PAR.map((p, i) => p + (i % 3 === 0 ? 0 : 1)),
      "Jasper Ashgrove": PAR.map((p, i) => (i === 11 ? p - 1 : p + 1)),
    };

    await test.step("Delphine keeps the fourball's cards on her phone", async () => {
      const { p, phone } = await member("Delphine Ashgrove");
      await open(p, "/me/card");
      await p.getByText("Group (4)", { exact: true }).click();
      const valueOf = async (name: string, hole: number) =>
        (await p.getByRole("button", { name: `One fewer stroke for ${name} on hole ${hole}` }).locator("xpath=following-sibling::*[1]").innerText()).trim();
      for (let h = 1; h <= 18; h += 1) {
        await p.getByRole("button", { name: new RegExp(`^Hole ${h},`) }).click();
        for (const [name, card] of Object.entries(cards)) {
          const target = card[h - 1];
          let v = await valueOf(name, h);
          if (!/^\d+$/.test(v)) {
            await p.getByRole("button", { name: `One more stroke for ${name} on hole ${h}` }).click();
            await expect.poll(() => valueOf(name, h)).toMatch(/^\d+$/);
            v = await valueOf(name, h);
          }
          for (let guard = 0; Number(v) !== target && guard < 8; guard += 1) {
            const dir = Number(v) < target ? "more" : "fewer";
            await p.getByRole("button", { name: `One ${dir} stroke for ${name} on hole ${h}` }).click();
            const before = v;
            await expect.poll(() => valueOf(name, h)).not.toBe(before);
            v = await valueOf(name, h);
          }
          if (h === 1) note(`first press on ${name} hole 1 → ${v}`);
        }
      }
      await p.waitForTimeout(2500);
      const text = (await p.locator("main").innerText()).replace(/\s+/g, " ");
      appendFileSync(LOG(), `\n## delphine-after-18\n${text.slice(0, 1600)}\n`);

      await test.step("…and tries to change Faye's card, which Faye has signed", async () => {
        await p.getByRole("button", { name: /^Hole 1,/ }).click();
        // Since #853 a partner's SIGNED card offers no steppers at all, and says why.
        const steppers = await p.getByRole("button", { name: /stroke for Faye Brackenbury on hole 1$/ }).count();
        const t = (await p.locator("main").innerText()).replace(/\s+/g, " ");
        const says = (t.match(/Faye[^.]{0,120}/g) || []).join(" | ");
        note(`Faye's signed card in Delphine's group view: steppers=${steppers}; screen says: ${says}`);
        expect(steppers, "a partner's signed card must not be editable").toBe(0);
        expect(says).toMatch(/signed/);
      });
      await phone.close();
    });

    await test.step("Jasper signs his card", async () => {
      const { p, phone } = await member("Jasper Ashgrove");
      await read(p, "/me/card", "jasper-card", 1500);
      const certify = p.getByRole("button", { name: /Certify my card/ });
      note(`jasper certify: ${await certify.count()}`);
      if (await certify.count()) {
        await certify.click();
        await p.waitForTimeout(2000);
      }
      await read(p, "/me", "jasper-today", 1200);
      await phone.close();
    });

    await test.step("Odile disputes the card Delphine kept for her", async () => {
      const { p, phone } = await member("Odile Ashgrove");
      await open(p, "/me/card");
      await p.getByText("Something on this card is wrong").first().click();
      await p.waitForTimeout(800);
      const panel = (await p.locator("main").innerText()).replace(/\s+/g, " ");
      appendFileSync(LOG(), `\n## odile-dispute-panel\n${panel.slice(-900)}\n`);
      const dispute = p.getByRole("button", { name: /Dispute this card/ });
      note(`odile dispute button: ${await dispute.count()}`);
      if (await dispute.count()) {
        await dispute.click();
        await p.waitForTimeout(2000);
      }
      await read(p, "/me/card", "odile-card-after", 1500);
      await read(p, "/me", "odile-today", 1200);
      await phone.close();
    });

    await test.step("Delphine signs her own", async () => {
      const { p, phone } = await member("Delphine Ashgrove");
      await open(p, "/me/card");
      const certify = p.getByRole("button", { name: /Certify my card/ });
      note(`delphine certify: ${await certify.count()}`);
      if (await certify.count()) {
        await certify.click();
        await p.waitForTimeout(2000);
      }
      await read(p, "/me/card", "delphine-card-after", 1200);
      await phone.close();
    });

    await test.step("what the secretary sees", async () => {
      const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
      await as(context, baseURL!, s.club);
      await read(page, "/entry", "entry", 3500);
    });
  }

  if (PHASE === "C2d") {
    const facts = await eventFacts(C_NAME);
    const member = async (name: string) => {
      const who = facts!.players.find((p) => p.name === name)!;
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`${name} ${new URL(p.url()).pathname}: ${String(e)}`));
      return { p, phone, who };
    };

    await test.step("Odile flags the card Delphine kept for her", async () => {
      const { p, phone } = await member("Odile Ashgrove");
      await open(p, "/me/card");
      await p.getByText("Something on this card is wrong").first().click();
      await p.getByRole("button", { name: /^Flag it/ }).click();
      await p.waitForTimeout(2000);
      await read(p, "/me/card", "odile-flagged", 1600);
      await read(p, "/me", "odile-today", 1200);
      await phone.close();
    });

    await test.step("Delphine's group view: Jasper and Odile are not hers to change now", async () => {
      const { p, phone } = await member("Delphine Ashgrove");
      await open(p, "/me/card");
      await p.getByText("Group (4)", { exact: true }).click();
      await p.waitForTimeout(800);
      const t = (await p.locator("main").innerText()).replace(/\s+/g, " ");
      appendFileSync(LOG(), `\n## delphine-group-now\n${t.slice(0, 1200)}\n`);
      for (const n of ["Faye Brackenbury", "Odile Ashgrove", "Jasper Ashgrove"]) {
        note(`${n}: + buttons ${await p.getByRole("button", { name: `One more stroke for ${n} on hole 1` }).count()}`);
      }
      await p.screenshot({ path: join(OUT, "five-C2d-delphine-group.png") });
      await phone.close();
    });

    await test.step("Faye finds the 1st changed, puts it back, and signs again", async () => {
      const { p, phone } = await member("Faye Brackenbury");
      await read(p, "/me", "faye-today-before", 1000);
      await open(p, "/me/card");
      await p.getByRole("button", { name: /^Hole 1,/ }).click();
      await p.getByRole("textbox", { name: "Strokes on hole 1" }).fill("4");
      await p.waitForTimeout(2000);
      const certify = p.getByRole("button", { name: /Certify my card/ });
      note(`faye re-certify: ${await certify.count()}`);
      if (await certify.count()) await certify.click();
      await p.waitForTimeout(2000);
      await read(p, "/me", "faye-today-after", 1000);
      await phone.close();
    });

    await test.step("Lettice enters twelve holes and stops", async () => {
      const { p, phone } = await member("Lettice Coldwell");
      await open(p, "/me/card");
      const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
      // Off the 10th: holes 10..18 then 1..3.
      for (const h of [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3]) {
        await p.getByRole("button", { name: new RegExp(`^Hole ${h},`) }).click();
        await p.getByRole("textbox", { name: `Strokes on hole ${h}` }).fill(String(PAR[h - 1] + 1));
        await expect(p.getByRole("button", { name: `Hole ${h}, not scored` })).toHaveCount(0);
      }
      await p.waitForTimeout(2000);
      await read(p, "/me", "lettice-today", 1200);
      await phone.close();
    });

    await test.step("the secretary imports the rest of the field's cards", async () => {
      const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
      await as(context, baseURL!, s.club);
      const kept = new Set(["Faye Brackenbury", "Delphine Ashgrove", "Odile Ashgrove", "Jasper Ashgrove", "Lettice Coldwell", "Xanthe Coldwell"]);
      const r = rng(11);
      const rows = facts!.players
        .filter((p) => p.status === "confirmed" && !kept.has(p.name))
        .map((p) => {
          // Course handicap off slope 128 and a 71.8 rating on a par 72.
          const ch = Math.round((p.handicap * 128) / 113 + (71.8 - 72));
          return `${p.name},${card(ch, r).join(",")}`;
        });
      note(`importing ${rows.length} cards`);
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
      await read(page, "/entry", "entry-after-import", 3000);
      await read(page, "/leaderboard", "board-after-import", 2500);
      await read(page, "/dashboard", "dashboard-after-import", 2500);
    });
  }

  if (PHASE === "C2e") {
    const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
    await as(context, baseURL!, s.club);
    await read(page, "/dashboard", "dashboard", 3500);
    await read(page, "/leaderboard", "board", 3000);
    await open(page, "/entry");
    const approval = page.locator(".card", { hasText: "Approve this round" }).first();
    appendFileSync(LOG(), `\n## approval-panel\n${(await approval.innerText().catch(() => "none")).replace(/\s+/g, " ").slice(0, 1500)}\n`);
    const anyway = await page.getByRole("button", { name: "Approve anyway" }).count();
    note(`"Approve anyway" buttons: ${anyway}`);
    const clean = page.getByRole("button", { name: /^Approve \d+ clean card/ });
    note(`clean button: ${(await clean.textContent().catch(() => "none"))?.trim()}`);
    await page.screenshot({ path: join(OUT, "five-C2e-entry.png"), fullPage: false });
  }

  if (PHASE === "C3a") {
    const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
    await as(context, baseURL!, s.club);
    await open(page, "/entry");
    const t0 = Date.now();
    const clean = page.getByRole("button", { name: /^Approve \d+ clean card/ });
    if (await clean.count()) {
      await clean.click();
      await page.waitForTimeout(2500);
    }
    note(`clean approved in ${Date.now() - t0}ms`);

    // Every card a member did not sign: the 114 the committee imported.
    // Leave the disputed and the incomplete — those are decisions, not stamps.
    const panel = page.locator(".card", { hasText: "Approve this round" }).first();
    const anyway = panel.getByRole("button", { name: "Approve anyway" });
    // The panel lists the disputed and the incomplete first; the unsigned
    // follow. Approve from the bottom until those two decisions are all left.
    let approved = 0;
    const t1 = Date.now();
    for (let left = await anyway.count(); left > 2; left -= 1) {
      await anyway.last().click();
      await expect(anyway).toHaveCount(left - 1, { timeout: 20_000 });
      approved += 1;
    }
    note(`approved ${approved} uncertified cards one by one in ${Math.round((Date.now() - t1) / 1000)}s`);
    appendFileSync(LOG(), `\n## approval-panel-after\n${(await panel.innerText().catch(() => "gone")).replace(/\s+/g, " ").slice(0, 1200)}\n`);
    await read(page, "/dashboard", "dashboard-after-approvals", 2500);
  }

  if (PHASE === "C3b") {
    const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
    await as(context, baseURL!, s.club);

    await test.step("the committee looks at Odile's disputed card", async () => {
      await open(page, "/entry");
      const picker = page.getByLabel("Player", { exact: true });
      const value = await picker.locator("option", { hasText: "Odile Ashgrove" }).first().getAttribute("value");
      await picker.selectOption(value!);
      await page.waitForTimeout(1500);
      const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      // Past the 120-name player picker, to the card itself.
      const after = main.slice(main.lastIndexOf("(hcp ") + 12);
      appendFileSync(LOG(), `\n## odile-on-entry\n${after.slice(0, 2500)}\n`);
      await page.screenshot({ path: join(OUT, "five-C3b-odile-entry.png"), fullPage: false });
    });

    await test.step("Lettice did not hole out: disqualified, no return", async () => {
      await open(page, "/registration");
      const panel = page.locator("section", { has: page.getByText(/Disqualif/) }).first();
      const sel = panel.locator("select").first();
      const v = await sel.locator("option", { hasText: "Lettice Coldwell" }).first().getAttribute("value");
      await sel.selectOption(v!);
      await panel.getByLabel(/^Reason/).fill("No return — did not hole out on the 4th to 9th (Rule 3.3c)");
      // Two presses: ConfirmButton asks inline, not in a dialog.
      await panel.getByRole("button", { name: "Disqualify" }).first().click();
      await panel.getByRole("button", { name: "Disqualify" }).first().click();
      await page.waitForTimeout(2000);
      appendFileSync(LOG(), `\n## dq-panel\n${(await panel.innerText()).replace(/\s+/g, " ").slice(0, 800)}\n`);
    });

    await test.step("try to close Round 1, which makes the cut", async () => {
      await open(page, "/stages");
      const header = page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ });
      const box = page.getByRole("checkbox", { name: /^This round is finished/ });
      if (!(await box.isVisible()) || (await header.getAttribute("aria-expanded")) !== "true") await header.click();
      await box.click();
      await page.waitForTimeout(3000);
      const t = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      note(`close said: ${(t.match(/[^.]*(approval|disputed|Closing Round 1|Closed\. Untick)[^.]*\./g) || []).join(" | ")}`);
      await read(page, "/dashboard", "dashboard-after-close-try", 2500);
    });
  }

  if (PHASE === "C3c") {
    const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
    await as(context, baseURL!, s.club);

    await test.step("the committee settles Odile's card: her 2nd was a 4", async () => {
      await open(page, "/entry");
      const picker = page.getByLabel("Player", { exact: true });
      const v = await picker.locator("option", { hasText: "Odile Ashgrove" }).first().getAttribute("value");
      await picker.selectOption(v!);
      await page.waitForTimeout(1200);
      const full = page.getByRole("button", { name: "Full card" });
      if (await full.count()) await full.click();
      await page.getByLabel("Hole 2, par 4").fill("4");
      await page.getByRole("button", { name: /^Save scorecard/ }).click();
      await page.waitForTimeout(2500);
      let said = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      note(`after save: ${(said.match(/(Saved[^.]*|Not saved[^.]*|disputed[^.]*)\./gi) || []).slice(0, 4).join(" | ")}`);
      const panel = page.locator(".card", { hasText: "Approve this round" }).first();
      if (/already approved/.test(said)) {
        // Approved by mistake: the committee reopens it, corrects it, approves it.
        await panel.locator("summary", { hasText: /^Approved/ }).click();
        const reopen = panel.locator("li, div", { hasText: /^Odile Ashgrove/ }).getByRole("button", { name: /Reopen/ }).first();
        note(`reopen buttons for Odile: ${await panel.getByRole("button", { name: /Reopen/ }).count()} total`);
        await reopen.click();
        await page.waitForTimeout(2500);
        await page.getByLabel("Hole 2, par 4").fill("4");
        await page.getByRole("button", { name: /^Save scorecard/ }).click();
        await page.waitForTimeout(2500);
        said = (await page.locator("main").innerText()).replace(/\s+/g, " ");
        note(`after reopen + save: ${(said.match(/(Saved[^.]*|Not saved[^.]*|reopened[^.]*)\./gi) || []).slice(0, 4).join(" | ")}`);
      }
      const row = panel.locator("div", { hasText: /^Odile Ashgrove/ }).filter({ has: page.getByRole("button", { name: "Approve anyway" }) }).last();
      note(`odile approve buttons: ${await row.getByRole("button", { name: "Approve anyway" }).count()}`);
      await row.getByRole("button", { name: "Approve anyway" }).first().click();
      await page.waitForTimeout(2500);
      appendFileSync(LOG(), `\n## panel-after-odile\n${(await panel.innerText()).replace(/\s+/g, " ").slice(0, 500)}\n`);
    });

    await test.step("the cut", async () => {
      await open(page, "/dashboard");
      const cut = page.getByRole("region", { name: "The cut is ready" });
      note(`cut region: ${await cut.count()}`);
      appendFileSync(LOG(), `\n## cut-region\n${(await cut.innerText().catch(() => "none")).replace(/\s+/g, " ").slice(0, 900)}\n`);
      if (await cut.count()) {
        await cut.getByRole("button", { name: /Approve the cut/ }).click();
        await cut.getByRole("button", { name: /Make the cut/ }).click();
        await expect(async () => {
          await open(page, "/dashboard");
          await expect(page.getByRole("region", { name: "The cut is ready" })).toHaveCount(0);
        }).toPass({ timeout: 60_000 });
      }
      await read(page, "/dashboard", "dashboard-after-cut", 3000);
      await read(page, "/leaderboard", "board-after-cut", 3500);
    });

    await test.step("five members, the morning after the cut", async () => {
      const facts = await eventFacts(C_NAME);
      for (const name of ["Faye Brackenbury", "Odile Ashgrove", "Lettice Coldwell", "Xanthe Coldwell", "Delphine Ashgrove"]) {
        const who = facts!.players.find((p) => p.name === name)!;
        const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
        await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
        const p = await phone.newPage();
        p.on("pageerror", (e) => errors.push(`${name} ${new URL(p.url()).pathname}: ${String(e)}`));
        note(`MEMBER ${name} (${who.status})`);
        await read(p, "/me", `${name.split(" ")[0]}-today`, 1200);
        await read(p, "/me/board", `${name.split(" ")[0]}-board`, 900);
        await phone.close();
      }
    });
  }

  if (PHASE === "C3d") {
    // Whatever is still waiting on the committee, approved one by one.
    const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
    await as(context, baseURL!, s.club);
    await open(page, "/entry");
    const panel = page.locator(".card", { hasText: "Approve this round" }).first();
    const anyway = panel.getByRole("button", { name: "Approve anyway" });
    for (let left = await anyway.count(); left > 0; left -= 1) {
      await anyway.first().click();
      await expect(anyway).toHaveCount(left - 1, { timeout: 20_000 });
    }
    appendFileSync(LOG(), `\n## panel\n${(await panel.innerText()).replace(/\s+/g, " ").slice(0, 400)}\n`);
  }

  if (PHASE === "C4") {
    const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
    await as(context, baseURL!, s.club);

    await test.step("the approval list, the morning after", async () => {
      await open(page, "/entry");
      const panel = page.locator(".card", { hasText: "Approve this round" }).first();
      appendFileSync(LOG(), `\n## approval-panel\n${(await panel.innerText().catch(() => "none")).replace(/\s+/g, " ").slice(0, 700)}\n`);
    });

    await test.step("the cut", async () => {
      await open(page, "/dashboard");
      const cut = page.getByRole("region", { name: "The cut is ready" });
      note(`cut region: ${await cut.count()}`);
      appendFileSync(LOG(), `\n## cut-region\n${(await cut.innerText().catch(() => "none")).replace(/\s+/g, " ").slice(0, 900)}\n`);
      await page.screenshot({ path: join(OUT, "five-C4-cut-card.png"), fullPage: false });
      if (await cut.count()) {
        await cut.getByRole("button", { name: /Approve the cut/ }).click();
        await cut.getByRole("button", { name: /Make the cut/ }).click();
        await expect(async () => {
          await open(page, "/dashboard");
          await expect(page.getByRole("region", { name: "The cut is ready" })).toHaveCount(0);
        }).toPass({ timeout: 60_000 });
      }
      const facts = await eventFacts(C_NAME);
      const r2 = facts!.stages.find((st) => /Round 2/.test(st.description)) ?? facts!.stages[1];
      const cards = await roundCards(r2.id);
      note(`round 2 cards after the cut: ${cards.length}; round 1 closed: ${facts!.stages[0].closedAt ? "yes" : "no"}`);
      await read(page, "/dashboard", "dashboard-after-cut", 3000);
      await read(page, "/leaderboard", "board-after-cut", 3500);
    });

    await test.step("five members, the morning after the cut", async () => {
      const facts = await eventFacts(C_NAME);
      for (const name of ["Faye Brackenbury", "Odile Ashgrove", "Lettice Coldwell", "Xanthe Coldwell", "Delphine Ashgrove"]) {
        const who = facts!.players.find((p) => p.name === name)!;
        const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
        await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
        const p = await phone.newPage();
        p.on("pageerror", (e) => errors.push(`${name} ${new URL(p.url()).pathname}: ${String(e)}`));
        note(`MEMBER ${name} (${who.status})`);
        await read(p, "/me", `${name.split(" ")[0]}-today`, 1200);
        await phone.close();
      }
    });

    await test.step("the Round 2 tee sheet, drawn by position", async () => {
      const facts = await eventFacts(C_NAME);
      const r2 = facts!.stages[1];
      await open(page, `/foursomes?round=${r2.id}`);
      const redraw = page.getByRole("button", { name: /Re-draw this sheet/ });
      if (await redraw.count()) {
        // A sheet drawn before the cut: what does the screen say about it?
        const t = (await page.locator("main").innerText()).replace(/\s+/g, " ");
        note(`existing sheet says: ${(t.match(/[^.]*(left the field|no tee time|missed the cut)[^.]*\./g) || []).join(" | ") || "(no warning)"}`);
        await redraw.click();
      }
      await page.getByRole("button", { name: /^By position/ }).click();
      await page.locator("label.seg-opt", { hasText: /^\s*3\s*$/ }).click().catch(() => note("no 3-ball option"));
      await page.getByLabel("First tee").fill("08:00");
      await page.getByRole("button", { name: /^Save & publish/ }).click();
      await page.getByRole("button", { name: "Publish the tee sheet" }).click();
      await page.waitForTimeout(3000);
      await read(page, `/foursomes?round=${r2.id}`, "teesheet-r2", 3000);
    });
  }

  if (PHASE === "C4b") {
    const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
    await as(context, baseURL!, s.club);
    const facts = await eventFacts(C_NAME);
    const r2 = facts!.stages[1];
    await test.step("the console, the morning of Round 2", async () => {
      await read(page, "/dashboard", "dashboard-r2-morning", 3500);
      await read(page, "/entry", "entry-r2-morning", 1500);
    });
    await test.step("re-draw Round 2 by position", async () => {
      await open(page, `/foursomes?round=${r2.id}`);
      const redraw = page.getByRole("button", { name: /Re-draw this sheet/ });
      if (await redraw.count()) await redraw.click();
      await page.getByRole("button", { name: /^By position/ }).click();
      const pressed = await page.getByRole("button", { name: /Leaders out last|Leaders last/i }).first().evaluate((b) => getComputedStyle(b).borderColor).catch(() => "none");
      note(`leaders-last button border after By position: ${pressed}`);
      await page.locator("label.seg-opt", { hasText: /^\s*3\s*$/ }).click().catch(() => note("no 3-ball option"));
      await page.getByLabel("First tee").fill("08:00");
      await page.getByRole("button", { name: /^Save & publish/ }).click();
      await page.getByRole("button", { name: "Publish the tee sheet" }).click();
      await page.waitForTimeout(3000);
      await read(page, `/foursomes?round=${r2.id}`, "teesheet-r2-redrawn", 3000);
    });
    await test.step("two who missed it, and one who made it", async () => {
      for (const name of ["Xanthe Coldwell", "Delphine Ashgrove", "Faye Brackenbury"]) {
        const who = facts!.players.find((p) => p.name === name)!;
        const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
        await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
        const p = await phone.newPage();
        p.on("pageerror", (e) => errors.push(`${name} ${new URL(p.url()).pathname}: ${String(e)}`));
        note(`MEMBER ${name}`);
        await read(p, "/me", `${name.split(" ")[0]}-r2-today`, 1200);
        await read(p, "/me/card", `${name.split(" ")[0]}-r2-card`, 700);
        await phone.close();
      }
    });
  }

  if (PHASE === "C5") {
    const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
    const facts = await eventFacts(C_NAME);
    const r2 = facts!.stages[1];
    const holders = new Set((await roundCards(r2.id)).map((c) => c.playerId));
    const survivors = facts!.players.filter((p) => holders.has(p.id));
    note(`survivors: ${survivors.length}`);

    await test.step("a survivor keeps her own Round 2 card and signs it", async () => {
      const who = survivors.find((p) => p.name === "Faye Brackenbury") ?? survivors[0];
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`${who.name} ${new URL(p.url()).pathname}: ${String(e)}`));
      note(`KEEPS HER OWN: ${who.name}`);
      await read(p, "/me", "survivor-today", 1500);
      await open(p, "/me/card");
      const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
      for (let h = 1; h <= 18; h += 1) {
        await p.getByRole("button", { name: new RegExp(`^Hole ${h},`) }).click();
        await p.getByRole("textbox", { name: `Strokes on hole ${h}` }).fill(String(PAR[h - 1] + (h % 5 === 0 ? 1 : 0)));
        await expect(p.getByRole("button", { name: `Hole ${h}, not scored` })).toHaveCount(0);
      }
      await p.waitForTimeout(1500);
      await open(p, "/me/card");
      const certify = p.getByRole("button", { name: /Certify my card/ });
      note(`certify button: ${await certify.count()}`);
      if (await certify.count()) {
        await certify.click({ timeout: 15_000 });
        await p.waitForTimeout(2500);
      }
      await read(p, "/me/card", "survivor-card", 1500);
      await phone.close();
      holders.delete(who.id);
    });

    await test.step("the secretary imports the other Round 2 cards", async () => {
      await as(context, baseURL!, s.club);
      const r = rng(23);
      const rows = survivors
        .filter((p) => holders.has(p.id))
        .map((p) => `${p.name},${card(Math.round((p.handicap * 128) / 113 - 0.2), r).join(",")}`);
      const csv = ["Player," + Array.from({ length: 18 }, (_, i) => i + 1).join(","), ...rows].join("\n");
      await open(page, `/entry?round=${r2.id}`);
      await page.getByRole("button", { name: /Import scores/ }).click();
      await page.locator("textarea").first().fill(csv);
      await page.waitForTimeout(800);
      const go = page.getByRole("button", { name: /^Import \d+ rows?/ });
      note(`import button: ${(await go.textContent())?.trim()}`);
      await go.click();
      await expect(page.getByText(/Imported \d+ row/)).toBeVisible({ timeout: 120_000 });
      note(`import said: ${(await page.getByText(/Imported \d+ row/).first().textContent())?.trim()}`);
    });

    await test.step("the committee approves Round 2", async () => {
      await open(page, `/entry?round=${r2.id}`);
      const clean = page.getByRole("button", { name: /^Approve \d+ clean card/ });
      if (await clean.count()) {
        note(`clean: ${(await clean.textContent())?.trim()}`);
        await clean.click();
        await page.waitForTimeout(2500);
      }
      const panel = page.locator(".card", { hasText: "Approve this round" }).first();
      const anyway = panel.getByRole("button", { name: "Approve anyway" });
      const t1 = Date.now();
      let n = 0;
      for (let left = await anyway.count(); left > 0; left -= 1) {
        await anyway.last().click();
        await expect(anyway).toHaveCount(left - 1, { timeout: 20_000 });
        n += 1;
      }
      note(`approved ${n} one by one in ${Math.round((Date.now() - t1) / 1000)}s`);
      appendFileSync(LOG(), `\n## panel-after\n${(await panel.innerText().catch(() => "gone")).replace(/\s+/g, " ").slice(0, 500)}\n`);
      await read(page, "/dashboard", "dashboard-r2-approved", 3000);
    });
  }

  if (PHASE === "C6") {
    const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
    await as(context, baseURL!, s.club);
    if (!process.env.READ_ONLY) await test.step("close Round 2 and complete the championship", async () => {
      await open(page, "/dashboard");
      const ready = page.getByRole("region", { name: "The round is ready to close" });
      note(`ready-to-close card: ${await ready.count()}`);
      if (await ready.count()) {
        await ready.getByRole("button", { name: /^Close Round 2/ }).click();
        await ready.getByRole("button", { name: /Close the round/ }).click();
        await page.waitForTimeout(3000);
      }
      await read(page, "/dashboard", "dashboard-r2-closed", 2500);
      await page.getByRole("button", { name: "Complete tournament" }).first().click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      appendFileSync(LOG(), `\n## complete-dialog\n${(await dialog.innerText()).replace(/\s+/g, " ").slice(0, 1200)}\n`);
      await dialog.getByRole("button", { name: "Complete tournament" }).click();
      await page.waitForTimeout(4000);
    });
    await test.step("the result, as the club reads it", async () => {
      await read(page, "/dashboard", "dashboard-complete", 3000);
      await read(page, "/leaderboard", "board-final", 4000);
      await read(page, "/prizes", "prizes", 3500);
      await read(page, "/reports", "reports", 3000);
      const facts = await eventFacts(C_NAME);
      await read(page, `/live/${facts!.shareToken}`, "live-final", 3500);
    });

    await test.step("members read the result", async () => {
      const facts = await eventFacts(C_NAME);
      for (const name of ["Faye Brackenbury", "Lettice Coldwell", "Xanthe Coldwell"]) {
        const who = facts!.players.find((p) => p.name === name)!;
        const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
        await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
        const p = await phone.newPage();
        p.on("pageerror", (e) => errors.push(`${name} ${new URL(p.url()).pathname}: ${String(e)}`));
        note(`MEMBER ${name} (${who.status})`);
        await read(p, "/me", `${name.split(" ")[0]}-final`, 1500);
        await read(p, "/me/board", `${name.split(" ")[0]}-board-final`, 1000);
        await phone.close();
      }
    });
  }

  if (PHASE === "C7") {
    const s = JSON.parse(readFileSync(join(OUT, "sessions.json"), "utf8"));
    await as(context, baseURL!, s.club);
    await test.step("the secretary awards the prizes from the result", async () => {
      await open(page, "/prizes");
      const picks = page.getByRole("combobox", { name: /^Winner of / });
      const n = await picks.count();
      note(`prize pickers: ${n}`);
      const taken = new Set<string>();
      for (let i = 0; i < n; i += 1) {
        const pick = page.getByRole("combobox", { name: /^Winner of / }).nth(i);
        const label = await pick.getAttribute("aria-label");
        const options = await pick.locator("option").evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? "" })));
        // One prize each, the club's usual rule: the next finisher not already awarded.
        const choice = options.find((o) => o.v && !taken.has(o.v));
        note(`${label}: first offered ${options.slice(1, 4).map((o) => o.t.trim()).join(" | ")} -> ${choice?.t.trim()}`);
        if (!choice) continue;
        taken.add(choice.v);
        await pick.selectOption(choice.v);
        await page.waitForTimeout(1500);
      }
      await read(page, "/prizes", "prizes-awarded", 2500);
    });
    await test.step("the winners, on their phones", async () => {
      const facts = await eventFacts(C_NAME);
      for (const name of ["Faye Brackenbury", "Cosmo Coldwell"]) {
        const who = facts!.players.find((p) => p.name === name)!;
        const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
        await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
        const p = await phone.newPage();
        p.on("pageerror", (e) => errors.push(`${name} ${new URL(p.url()).pathname}: ${String(e)}`));
        await read(p, "/me", `${name.split(" ")[0]}-prize-today`, 1500);
        await phone.close();
      }
    });
  }

  appendFileSync(LOG(), `\n# page errors: ${errors.length}\n${errors.join("\n")}\n`);
});
