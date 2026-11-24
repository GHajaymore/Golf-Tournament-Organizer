import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn } from "./rounds-fixture";

/**
 * "LOOK UP A COURSE" ON TOURNAMENT DETAILS: THE TWO ANSWERS THAT ARE NOT A COURSE (B92, 2026-11-20).
 *
 * The secretary types a name and the lookup says no — "Nothing matching that", or "Couldn't reach the course
 * directory". Both are refusals, so both are `role="alert"` and brought into view where the press was
 * (CLAUDE.md, Hard rules on refusals; `bringIntoView`). Before B92 they were plain paragraphs: a screen reader
 * heard nothing, and on a phone the sentence could sit below the fold.
 *
 * NO LIVE CALL. The two answers are exactly the ones that, for real, leave the building (the stored catalogue
 * is empty, so the server asks the live directory, whose allowance every club shares). So the search ACTION'S
 * ANSWER is stubbed at the network: a server action is a POST carrying `next-action`, and its reply is a
 * two-line flight body. The first line is taken from a REAL reply (one catalogue course, found as you type —
 * the stored catalogue, nothing leaves) so the build's own framing is kept; the second line is ours.
 *
 * The B84 spec (`course-lookup-on-event.spec.ts`) walks the found / added / already-held paths; this file is
 * only the refusals.
 */

const WALKED = ["desktop", "phone"];
const WORD: Record<string, string> = { desktop: "Quillmoor", phone: "Brackenfell" };
const MISSING: Record<string, string> = { desktop: "Zxqvbnm", phone: "Qwjkxzt" };

test.describe.configure({ timeout: 180_000 });
// WebKit: a page.route does not see a request the service worker makes, so the stub never answered (G660-1).
test.use({ actionTimeout: 15_000, serviceWorkers: "block" });
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function openLookup(page: Page) {
  await page.goto(`/event?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name: "Look up a course" }).click();
  return page.getByRole("combobox", { name: "Search for a course by name or town" });
}

/** The refusal by its own role, never the page's alerts (Next's route announcer is one too). */
const refusal = (page: Page, text: RegExp) =>
  page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ hasText: text });

test("Look up a course: 'nothing matching' and 'directory not reachable' are alerts, said beside the box, in view", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = `zz-clr-${testInfo.project.name}`;
  const word = WORD[testInfo.project.name];
  const missing = MISSING[testInfo.project.name];
  const club = await makeClub(mark);
  const id = `${mark}-moor`;
  try {
    await prisma.courseCatalog.deleteMany({ where: { id: { startsWith: mark } } });
    await prisma.courseCatalog.create({
      data: {
        id,
        name: `${mark} ${word} Heath`,
        city: "Invented Bay",
        state: "OH",
        country: "US",
        par: 0,
        pars: "",
        yards: "",
        strokeIndex: "",
        tees: "[]",
        cardProblem: "",
      },
    });
    const { event } = await makeEvent(club, "Spring Medal", { status: "live", stages: [{}] });
    await signIn(context, baseURL!, club, event.id);

    const search = await openLookup(page);

    // A REAL reply, to borrow the build's framing from.
    // The body is NOT read through the browser's protocol (`response.text()`): a server action's reply is a
    // stream the browser drops once the page has taken what it needs, and CDP then has no body to give (G682
    // "navigated away from", then #1228 "No data found for resource" — the POST shows ERR_ABORTED with an
    // unknown size, with no navigation). The route fetches the real reply itself, in Node, keeps its first
    // line, and hands the page the same reply untouched.
    let frame: string | undefined;
    let answer: unknown = { ok: true, hits: [] };
    let stubbed = 0;
    await page.route("**/event**", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && "next-action" in req.headers() && (req.postData() ?? "").includes(word)) {
        const reply = await route.fetch();
        const body = await reply.text();
        frame ??= body.split("\n").find((l) => l.startsWith("0:"));
        await route.fulfill({ response: reply, body });
        return;
      }
      if (req.method() === "POST" && "next-action" in req.headers() && (req.postData() ?? "").includes(missing)) {
        stubbed += 1;
        await route.fulfill({
          status: 200,
          headers: { "content-type": "text/x-component" },
          body: `${frame}\n1:${JSON.stringify(answer)}\n`,
        });
        return;
      }
      await route.continue();
    });
    await search.fill(word);
    await expect(page.getByRole("option").filter({ hasText: word })).toBeVisible({ timeout: 20_000 });
    expect(frame, "CONTROL: the real reply had no first line to borrow").toBeTruthy();

    await test.step("nothing found: an alert, in view, and it names the way out", async () => {
      await search.fill(missing);
      const said = refusal(page, /Nothing matching that/);
      await expect(said, "no result was not announced as an alert where the search was").toBeVisible({ timeout: 20_000 });
      await expect(said).toContainText("Try fewer letters");
      await expect(said).toBeInViewport();
      expect(stubbed, "CONTROL: the stub never answered, so the real directory may have been asked").toBeGreaterThan(0);
    });

    await test.step("the directory did not answer: an alert with the reason, in view", async () => {
      answer = { ok: false, error: "Couldn't reach the course directory (invented outage)." };
      await search.fill(`${missing}x`);
      const said = refusal(page, /invented outage/);
      await expect(said, "an unreachable directory was not announced as an alert").toBeVisible({ timeout: 20_000 });
      await expect(said).toBeInViewport();
      await expect(refusal(page, /Nothing matching that/), "the old answer stayed beside the new one").toHaveCount(0);
    });

    expect(errors, `screen errors:\n${errors.join("\n")}`).toEqual([]);
  } finally {
    await prisma.courseCatalog.deleteMany({ where: { id: { startsWith: mark } } }).catch(() => {});
    await dropClub(mark).catch(() => {});
  }
});
