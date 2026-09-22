import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OrganizationAccess } from "@/components/OrganizationAccess";
import { OrgProfileProvider } from "@/components/OrgProfileProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/organization",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/actions/organization", () => ({
  setOrganizationMemberRole: vi.fn(async () => ({ ok: true })),
  removeOrganizationMember: vi.fn(async () => ({ ok: true })),
  addOrganizationMember: vi.fn(async () => ({ ok: true })),
  answerJoinRequest: vi.fn(async () => ({ ok: true })),
}));

/**
 * "STAFF" MEANT TWO DIFFERENT SETS ON ONE SCREEN.
 *
 * Ajay spotted the symptom on 2026-09-21: the Staff stat card read 1 while the
 * table directly beneath it said 2, on a page whose own comment claimed the
 * card counted the BROADER set. Measured against real rows, neither set
 * contains the other and the two disagree in both directions:
 *
 *     Braid Hollow (seeded)   card 1, table 2 — the roster holds a `member`,
 *                             who has no organizer rights at all
 *     Demo Golf Club          card 3, table 1 — two people hold admin on
 *                             individual events and have no organization row
 *
 * Both numbers were correct about their own question. What was missing was any
 * sentence admitting they were different questions, and a heading that used
 * one word for both.
 *
 * The rule pinned here: the roster is not called staff, and the seat number
 * shown is the one the caller passed — never a second opinion computed from
 * `report`, which is precisely how two readers of one question drift apart.
 */

const person = (over: Record<string, unknown> = {}) => ({
  email: "a@example.invalid",
  name: "A Person",
  orgRole: "owner",
  memberId: "m1",
  hasLogin: true,
  access: {},
  ...over,
});

const render = (people: ReturnType<typeof person>[], seats: number) =>
  renderToStaticMarkup(
    <OrgProfileProvider kind="club">
      <OrganizationAccess
        report={
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { events: [{ id: "e1", name: "Spring Medal", dates: "May 14" }], people } as any
        }
        canEdit
        asks={[]}
        seats={seats}
      />
    </OrgProfileProvider>,
  );

describe("one word, one set of staff", () => {
  it("does not call the roster count staff", () => {
    // Two rows, one of whom is a member with no rights. Heading it
    // "Club staff (2)" over a stat card reading 1 is the defect.
    const html = render(
      [person(), person({ email: "b@example.invalid", orgRole: "member", memberId: "m2" })],
      1,
    );
    expect(html).not.toMatch(/Club staff \(/i);
    expect(html).toMatch(/Club roster \(2\)/i);
  });

  it("prints the seat number it was given, next to the roster count", () => {
    const html = render(
      [person(), person({ email: "b@example.invalid", orgRole: "member", memberId: "m2" })],
      1,
    );
    expect(html).toMatch(/1 person holds a staff seat/i);
  });

  /**
   * The control, and the reason the test above is not satisfied by printing
   * the roster length twice. A screen that derived the seat count from
   * `report` would produce 2 here and look perfectly reasonable — that is the
   * exact failure being prevented, so the fixture makes the two numbers
   * differ and pins the one that came from outside.
   */
  it("takes the seat count from the caller, not from the roster it is showing", () => {
    const three = render([person(), person({ email: "b@example.invalid", memberId: "m2" })], 3);
    // Three seats against a two-row roster: only the passed-in number can say 3.
    expect(three).toMatch(/3 people hold a staff seat/i);
    expect(three).toMatch(/roster \(2\)/i);
  });

  it("does not tell event-only people they are not staff, because some are", () => {
    // The demo club's two event admins hold seats and are in this group. The
    // true statement about all of them is that they have no role at the club.
    const html = render(
      [person(), person({ email: "c@example.invalid", orgRole: null, memberId: null })],
      2,
    );
    expect(html).not.toMatch(/are not\s+club staff/i);
    expect(html).toMatch(/without a role at the club/i);
  });
});
