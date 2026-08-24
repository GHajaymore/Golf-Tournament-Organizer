/**
 * Prove the drafting panel reaches the announcements screen, and that the
 * screen tells the truth about what it does.
 *
 * The unit tests pin the invented-name check and prove the action has no path
 * to the mailer. Neither asks the question a club would ask: standing on the
 * announcements page, can I see what this thing is, and does it say plainly
 * that it will not send anything on my behalf?
 *
 * Everything created here is named for the mark, so the cleanup can only ever
 * remove its own rows — never the demo data and never a real event.
 */
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const MARK = "zz-verify-drafting";
const prisma = new PrismaClient();

const made = {};
let failures = 0;

/** React splits interpolated text with HTML comments during server rendering. */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

function check(label, html, needle, shouldContain = true) {
  const found = stripComments(html).includes(needle);
  const ok = found === shouldContain;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}: ${shouldContain ? "contains" : "omits"} "${needle}"`);
}

async function main() {
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });

    const org = await prisma.organization.create({ data: { name: `${MARK}-club`, kind: "club" } });
    made.orgId = org.id;
    const event = await prisma.event.create({
      data: {
        name: `${MARK}-event`,
        organizationId: org.id,
        status: "active",
        shape: "series",
        dates: "May 1, 2026",
        course: "",
        city: "Cincinnati, OH",
        address: "",
        regDeadline: "",
        shareToken: randomBytes(12).toString("hex"),
      },
    });
    made.eventId = event.id;

    const user = await prisma.user.create({
      data: {
        email: `${MARK}@example.invalid`,
        name: "Verify Organizer",
        password: `${randomBytes(8).toString("hex")}:unusable`,
      },
    });
    made.userId = user.id;
    await prisma.account.create({
      data: { eventId: event.id, name: user.name, email: user.email, role: "admin" },
    });

    const secret = process.env.AUTH_SECRET ?? "dev-secret";
    const mac = createHmac("sha256", secret).update(user.id).digest("base64url");
    const cookie = `ng_session=${user.id}.${mac}`;

    const res = await fetch(`${BASE}/announcements`, { headers: { cookie }, redirect: "follow" });
    const html = await res.text();

    console.log(`Verifying against ${BASE}\n`);
    console.log(`Announcements — /announcements  (status ${res.status})`);
    if (res.status !== 200) failures += 1;

    // The panel is there and says what it is.
    check("panel renders", html, "Draft it from the results");

    /**
     * The panel has TWO legitimate shapes, and the plan decides which.
     *
     * `aiAssist` is dark on both tiers today — a draft costs money to
     * generate — so every club sees the LOCKED shape. This script asserted
     * only the unlocked one, so five checks failed against an app that was
     * behaving correctly, and the CI step running it had never once gone
     * green. Everything queued behind that step, the whole e2e suite
     * included, therefore never ran at all.
     *
     * A verify script pinned to a shape nobody can reach is worse than no
     * script: it reports a fault that is not there, and it hides the faults
     * that are. So check whichever shape rendered — and fail if NEITHER did,
     * which is the regression this file was written to catch.
     */
    const locked = stripComments(html).includes("AjAi writes a first draft");
    console.log(`  --    plan renders the ${locked ? "LOCKED" : "UNLOCKED"} shape`);

    if (locked) {
      // A locked feature has to say what to do instead, or it reads as broken.
      check("names the feature", html, "AjAi drafting");
      check("says it is a paid feature", html, "On the paid plan");
      check("says what to do instead", html, "Write it yourself below and send as usual.");
      // And it must not dangle the choices it cannot honour.
      check("offers no options it cannot deliver", html, "Newsletter recap", false);
    } else {
      check("explains the limit up front", html, "Drafts only — you edit it and post it yourself");

      // Every kind an organizer can ask for is offered.
      check("results option", html, "Results announcement");
      check("recap option", html, "Newsletter recap");
      check("reminder option", html, "Reminder about the next round");
      check("thanks option", html, "Thank-you at the end");
    }

    // "Put in the message box" is deliberately NOT asserted here: it only
    // exists once a draft has come back, which needs a configured key. What
    // can be proved from a cold page is that nothing on it offers to send.
    check("no send button anywhere in the panel", html, "Draft and send", false);
    check("no auto-post", html, "Post automatically", false);

    // The organizer's own composer is still the thing that posts.
    check("composer still present", html, "Post an announcement");

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  } finally {
    if (made.eventId) await prisma.event.deleteMany({ where: { id: made.eventId } });
    if (made.userId) await prisma.user.deleteMany({ where: { id: made.userId } });
    if (made.orgId) await prisma.organization.deleteMany({ where: { id: made.orgId } });
    await prisma.$disconnect();
    console.log("Fixtures removed.");
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
