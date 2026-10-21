import { createHmac, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, type BrowserContext, type Locator, type Page } from "./coverage";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A THROWAWAY CLUB FOR ONE TEST, BUILT IN THE STATE THE TEST NEEDS.
 *
 * The specs that set up a tournament's rounds (`rounds-and-formats.spec.ts`,
 * `match-play-rules.spec.ts`) each need a club in a particular state — a
 * free-plan club the Par terms apply to, a club whose clock is on a different
 * day from the server's, a draft tournament whose setup is open, a live one
 * whose setup is locked — and the standing fixture is none of those. So each
 * test makes its own club here and drops it in a `finally`.
 *
 * Every row carries the caller's mark (`zz-…`), names are invented, addresses
 * are `@example.invalid`. Access is the club's own: the organizer is the
 * club's OWNER (`OrganizationMember`), which is how a secretary reaches every
 * tournament of their club — no Account row per tournament.
 */

export const prisma = new PrismaClient();

const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

/** A pars and stroke-index card, so a round has holes to count back over. */
const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
export const CARD_PARS = PARS;

/** Invented golfers. None is a real person. */
export const NAMES = [
  "Ffion Arkwright-Delacroix",
  "Tomás Ó Briain",
  "Kiri Waititi-Moss",
  "Bea Lindqvist",
  "Oswin Pargeter",
  "Mirela Szántó",
  "Dex Okonkwo-Hale",
  "Prue Fairweather",
];

export type Club = { orgId: string; userId: string; session: string; mark: string };

/** The day N days from `iso`, as yyyy-mm-dd. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n, 12));
  return t.toISOString().slice(0, 10);
}

/** Today in a zone ("" is this machine's own day, which is the server's). */
export function dayIn(zone: string, at = new Date()): string {
  if (!zone) {
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export async function makeClub(
  mark: string,
  opts: { plan?: string; planTermsApply?: boolean; timeZone?: string } = {},
): Promise<Club> {
  await dropClub(mark);
  const org = await prisma.organization.create({
    data: { name: `${mark} Golf Society`, kind: "club", themeAppearance: "auto", timeZone: opts.timeZone ?? "" },
  });
  await prisma.subscription.create({
    data: { organizationId: org.id, plan: opts.plan ?? "society", planTermsApply: opts.planTermsApply ?? false },
  });
  const user = await prisma.user.create({
    data: { email: `${mark}-secretary@example.invalid`, name: "Rowan Secretary", password: "x:unusable" },
  });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });
  return { orgId: org.id, userId: user.id, session: sign(signedInNow(user.id)), mark };
}

/** Everything the mark made. Organizations cascade to their tournaments and their rows. */
export async function dropClub(mark: string) {
  await prisma.organization.deleteMany({ where: { name: { startsWith: mark } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: mark } } });
}

type StageSpec = {
  type?: string;
  format?: string;
  holes?: number;
  scoringBasis?: string;
  playedOn?: string;
  deadline?: string;
};

export async function makeEvent(
  club: Club,
  name: string,
  opts: {
    status?: string;
    configUnlocked?: boolean;
    stages: StageSpec[];
    players?: number;
    /** Split the field into this many flights, in entry order. */
    flights?: number;
    event?: Record<string, unknown>;
  },
) {
  const event = await prisma.event.create({
    data: {
      organizationId: club.orgId,
      name: `${club.mark} ${name}`,
      status: opts.status ?? "registration",
      configUnlocked: opts.configUnlocked ?? false,
      shape: "single",
      format: "stroke",
      dates: "",
      course: `${club.mark} Hollins Moss`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${club.mark}-${randomBytes(6).toString("hex")}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(SI),
      ...(opts.event ?? {}),
    },
  });
  const stages = [];
  for (const [i, s] of opts.stages.entries()) {
    stages.push(
      await prisma.stage.create({
        data: {
          eventId: event.id,
          position: i,
          type: s.type ?? "Stroke Play Round",
          format: s.format ?? "Stroke Play",
          holes: s.holes ?? 18,
          scoringBasis: s.scoringBasis ?? "net",
          playedOn: s.playedOn ?? "",
          deadline: s.deadline ?? "",
        },
      }),
    );
  }
  const flightCount = opts.flights ?? 0;
  const flights = [];
  for (let f = 0; f < flightCount; f++) {
    flights.push(await prisma.group.create({ data: { eventId: event.id, name: `Flight ${String.fromCharCode(65 + f)}`, position: f } }));
  }
  const n = opts.players ?? 4;
  const players = [];
  for (let i = 0; i < n; i++) {
    const per = flightCount ? Math.ceil(n / flightCount) : n;
    players.push(
      await prisma.player.create({
        data: {
          eventId: event.id,
          name: NAMES[i],
          email: `${club.mark}-p${i}@example.invalid`,
          handicap: 6 + i * 3.4,
          seed: i + 1,
          status: "confirmed",
          ...(flightCount ? { groupId: flights[Math.floor(i / per)].id } : {}),
        },
      }),
    );
  }
  return { event, stages, players, flights };
}

/** A whole card for one player in one round — what "a round with cards in it" means. */
export async function returnCard(eventId: string, stageId: string, playerId: string, holes = 18) {
  await prisma.scorecard.create({
    data: { eventId, stageId, playerId, strokes: JSON.stringify(PARS.slice(0, holes).map((p) => p + 1)), status: "entered" },
  });
}

export async function signIn(context: BrowserContext, baseURL: string, club: Club, eventId: string) {
  await signInWith(context, baseURL, club.session, eventId);
}

/** Any signed session, into one tournament — a member's phone, a second secretary. */
export async function signInWith(context: BrowserContext, baseURL: string, session: string, eventId: string) {
  await context.addCookies([
    { name: "ng_session", value: session, url: baseURL },
    { name: "ng_active_event", value: sign(eventId), url: baseURL },
  ]);
}

/**
 * A MEMBER WHO SIGNS IN AS THEMSELVES: a User at the address their entry carries,
 * and the tournament's player account. The address must begin with the club's
 * mark (the entries `makeEvent` makes do), so `dropClub` takes the User too.
 */
export async function memberSession(eventId: string, email: string, name: string): Promise<{ userId: string; session: string }> {
  const user = await prisma.user.create({ data: { email, name, password: "x:unusable" } });
  await prisma.account.create({ data: { eventId, name, email, role: "player" } });
  return { userId: user.id, session: sign(signedInNow(user.id)) };
}

/** A signed session for a User this spec made. */
export const sessionOf = (userId: string) => sign(signedInNow(userId));

export async function gotoStages(page: Page) {
  await page.goto(`/stages?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("main h1")).toBeVisible();
}

/** A round's card, opened. Rounds & formats opens one of one or two rounds and none of three. */
export async function openRound(page: Page, stageId: string): Promise<Locator> {
  const card = page.locator(`[id="round-${stageId}"]`);
  await expect(card, "Rounds & formats has no card for this round").toBeVisible();
  const head = card.locator("button[aria-expanded]").first();
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  return card;
}

/** "Customize this round", opened. */
export async function openCustomize(card: Locator) {
  const b = card.getByRole("button", { name: /^Customize this round/ });
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  await expect(b).toHaveAttribute("aria-expanded", "true");
}

/**
 * The control a person is about to press, in the middle of their screen — where
 * it is when they press it. Playwright scrolls a control only until its edge is
 * in view (and `selectOption` not at all), which on a phone leaves it under the
 * bottom bar and measures a refusal against a screen nobody would be looking at.
 */
export async function centre(control: Locator) {
  await control.evaluate((el) => el.scrollIntoView({ block: "center" }));
}

/**
 * One choice of a segmented control, pressed as a person presses it: on its
 * label. The radio inside is drawn invisible (`.seg-opt input`), so the label is
 * the thing on the screen — and the thing a refusal is measured against.
 */
export async function pick(group: Locator, name: string): Promise<{ radio: Locator; label: Locator }> {
  const radio = group.getByRole("radio", { name, exact: true });
  const label = radio.locator("xpath=ancestor::label[1]");
  await centre(label);
  await label.click();
  return { radio, label };
}

/**
 * A REFUSAL IS SAID WHERE THE PRESS WAS: on the screen, and within `px` of the
 * control that was pressed (CLAUDE.md, "A refusal is said where the press was").
 */
export async function saidBeside(said: Locator, control: Locator, what: string, px = 200) {
  await expect(said, `${what}: the refusal is not on the screen`).toBeInViewport();
  const a = await said.boundingBox();
  const b = await control.boundingBox();
  expect(a && b, `${what}: could not measure the refusal or the control`).toBeTruthy();
  const gap = Math.max(0, a!.y - (b!.y + b!.height), b!.y - (a!.y + a!.height));
  expect(gap, `${what}: the refusal is ${Math.round(gap)}px from the control that was pressed`).toBeLessThanOrEqual(px);
}
