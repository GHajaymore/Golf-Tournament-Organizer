import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * AN ACTION THAT CHANGES THE CLUB ASKS WHO IS ASKING (2026-10-11).
 *
 * `audit-idor.test.ts` holds every server action to "it checks authorization",
 * and for a club-level action that check is two steps: WHICH club is this
 * person in (`currentOrganization()`), and MAY THEY change it (`canEdit`,
 * owner-only for billing). The first step alone answers "yes" for every
 * member of the club — a player, a guest entered for one charity day.
 *
 * Found by mutation: with the role check deleted from the new time-zone
 * setting, `audit-idor` stayed green — a member could have moved every
 * deadline in their club — and so did the every-action sweep, whose made-up
 * arguments are refused by the action's own validation before the missing
 * check could matter. Nothing was wrong in the nineteen actions that existed;
 * nothing would have said so if something had been.
 *
 * Source is read through `readSource`, which strips comments: these actions'
 * own doc blocks say "Only a Commissioner or Admin…", and prose must not be
 * what satisfies the rule.
 */

/** What counts as asking about the caller's role. */
const ROLE_CHECKS = [".canEdit", ".isOwner", "canManage"];

/** Every exported action in a file, with its body (up to the next export). */
function actionsIn(src: string): Array<{ name: string; body: string }> {
  return src
    .split("export async function ")
    .slice(1)
    .map((piece) => ({ name: piece.slice(0, piece.indexOf("(")), body: piece }));
}

const resolvesTheClub = (body: string) => body.includes("currentOrganization()") || body.includes("organizationAccess(");
const asksTheRole = (body: string) => ROLE_CHECKS.some((c) => body.includes(c));

const FILES = readdirSync(join(process.cwd(), "src", "app", "actions")).filter((f) => f.endsWith(".ts"));
const CLUB_ACTIONS = FILES.flatMap((file) =>
  actionsIn(readSource("src", "app", "actions", file))
    .filter((a) => resolvesTheClub(a.body))
    .map((a) => ({ file, ...a })),
);

describe("an action that works on the caller's club", () => {
  it("checks the caller's role, not only their membership", () => {
    const open = CLUB_ACTIONS.filter((a) => !asksTheRole(a.body)).map((a) => `${a.file}: ${a.name}`);
    expect(open, "resolves the club and never asks whether this person may change it").toEqual([]);
  });

  it("CONTROL: the club's actions are found, the new ones among them", () => {
    const names = CLUB_ACTIONS.map((a) => a.name);
    expect(names.length).toBeGreaterThanOrEqual(19);
    for (const known of ["saveOrganizationTimeZone", "adoptClubTimeZone", "saveOrganizationLocale", "addOrganizationMember", "startCheckout"]) {
      expect(names, known).toContain(known);
    }
  });

  it("CONTROL: an action with the role check deleted is seen", () => {
    const without = actionsIn(
      [
        "export async function saveOrganizationTimeZone(timeZone: string) {",
        "  const org = await currentOrganization();",
        '  if (!org) return { ok: false, error: "No organization found." };',
        "  await prisma.organization.update({ where: { id: org.organizationId }, data: { timeZone } });",
        "}",
      ].join("\n"),
    );
    expect(without.filter((a) => resolvesTheClub(a.body) && !asksTheRole(a.body)).map((a) => a.name)).toEqual([
      "saveOrganizationTimeZone",
    ]);
    const withIt = actionsIn(
      [
        "export async function saveOrganizationTimeZone(timeZone: string) {",
        "  const org = await currentOrganization();",
        "  if (!org?.canEdit) return { ok: false };",
        "}",
      ].join("\n"),
    );
    expect(withIt.filter((a) => !asksTheRole(a.body))).toEqual([]);
  });
});
