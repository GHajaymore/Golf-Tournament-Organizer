import { describe, it, expect } from "vitest";
import { checkInterest, cleanSource, interestSource, interestSubject, INTEREST_COPY, INTEREST_LIMITS, INTEREST_ROLES } from "@/lib/domain/interest";
import { interestWords, HELD_FRONT_DOOR, SIGNINS_CLOSED_NOTICE } from "@/lib/go-live";

/**
 * THE /interest FORM'S RULES (2026-10-21) — `checkInterest` is the only door,
 * and a "use server" action is called with whatever the caller likes.
 */
const good = { name: "Zz Pat", email: " Pat@Example.Invalid ", phone: "", club: "Zz Oakmere GC", role: "secretary", members: "50-150", note: "" };

describe("email required, phone optional (Ajay, 2026-10-21)", () => {
  it("no phone is fine — email is the required one, since the code goes there", () => {
    expect(checkInterest({ ...good, phone: "" }).ok).toBe(true);
    expect(checkInterest({ ...good, phone: undefined }).ok).toBe(true);
  });

  it("a phone in any country's shape is kept as typed", () => {
    for (const phone of ["+1 (513) 555-0142", "020 7946 0958", "+44 7700 900123", "0412.345.678"]) {
      const r = checkInterest({ ...good, phone });
      expect(r.ok && r.clean.phone, phone).toBe(phone);
    }
  });

  it("a phone that is not one is refused beside its box", () => {
    for (const phone of ["call me", "12345", "+1 555 CALL NOW"]) {
      const r = checkInterest({ ...good, phone });
      expect(!r.ok && "field" in r && r.field, phone).toBe("phone");
    }
  });
});

describe("what the form accepts", () => {
  it("a whole answer, tidied: the address lower-cased and trimmed", () => {
    const r = checkInterest(good);
    expect(r).toEqual({ ok: true, clean: { ...good, email: "pat@example.invalid", source: "" } });
  });

  it("size is optional, and an unknown size is dropped rather than stored", () => {
    for (const members of ["", "lots", undefined]) {
      const r = checkInterest({ ...good, members });
      expect(r.ok && r.clean.members).toBe("");
    }
  });

  it("every field is cut to its length — a caller cannot store a novel", () => {
    const r = checkInterest({ ...good, name: "x".repeat(500), club: "y".repeat(500), note: "z".repeat(5000) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.clean.name).toHaveLength(INTEREST_LIMITS.name);
      expect(r.clean.club).toHaveLength(INTEREST_LIMITS.club);
      expect(r.clean.note).toHaveLength(INTEREST_LIMITS.note);
    }
  });
});

describe("what it refuses, and which box the refusal belongs to", () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["no name", { ...good, name: "  " }, "name"],
    ["no address", { ...good, email: "" }, "email"],
    ["not an address", { ...good, email: "pat at home" }, "email"],
    ["no club", { ...good, club: "" }, "club"],
    ["nobody chosen", { ...good, role: "" }, "role"],
    ["a role the form does not offer", { ...good, role: "admin" }, "role"],
  ];
  for (const [what, input, field] of cases) {
    it(what, () => {
      const r = checkInterest(input);
      expect(r.ok).toBe(false);
      expect(!r.ok && "field" in r && r.field).toBe(field);
    });
  }

  it("anything that is not an object, field by field as unknown — never a throw", () => {
    for (const raw of [null, undefined, 42, "x", [], { name: 7, email: {} }]) {
      expect(() => checkInterest(raw)).not.toThrow();
      expect(checkInterest(raw).ok).toBe(false);
    }
  });

  it("a filled hidden box is a script, answered as spam and told nothing", () => {
    expect(checkInterest({ ...good, website: "http://spam.example" })).toEqual({ ok: false, spam: true });
  });

  it("CONTROL: an empty hidden box is a person", () => {
    expect(checkInterest({ ...good, website: "" }).ok).toBe(true);
  });
});

describe("where a note came from — read off the address, no cookie", () => {
  it("keeps the campaign tags and the site that sent them, in a fixed order", () => {
    expect(interestSource("?utm_campaign=pre-c1&utm_source=meta&x=1", "https://www.facebook.com/ads", "tourneyhq.club")).toBe(
      "utm_source=meta; utm_campaign=pre-c1; from=facebook.com",
    );
  });

  it("our own pages are not a source, and nothing at all is 'direct' (empty)", () => {
    expect(interestSource("", "https://tourneyhq.club/faq", "tourneyhq.club")).toBe("");
    expect(interestSource("", "", "tourneyhq.club")).toBe("");
  });

  it("a caller cannot store markup or a novel in it", () => {
    const s = cleanSource("utm_source=<script>alert(1)</script>" + "x".repeat(900));
    expect(s).not.toMatch(/[<>()]/);
    expect(s.length).toBeLessThanOrEqual(300);
  });

  it("the action keeps it from the form, cleaned", () => {
    const r = checkInterest({ ...good, source: "utm_source=google; <b>" });
    expect(r.ok && r.clean.source).toBe("utm_source=google; b");
  });
});

describe("what it says", () => {
  it("the offer names the first term, and never prints a code", () => {
    for (const words of [interestWords("held").sub, SIGNINS_CLOSED_NOTICE.offer]) {
      expect(words).toMatch(/25%/);
      expect(words).toMatch(/first (term|month)/);
      expect(words).not.toMatch(/\b[A-Z0-9]{6,}\b/);
    }
  });

  it("every held place that offers the early list says joining is free and needs no card (Ajay, 31 Oct, #975)", () => {
    expect(interestWords("held").sub.startsWith("Free to join, no card needed.")).toBe(true);
    for (const said of [interestWords("held").sub, HELD_FRONT_DOOR.lead, HELD_FRONT_DOOR.pricingNote, SIGNINS_CLOSED_NOTICE.offer]) {
      expect(said, said).toMatch(/free/i);
      expect(said, said).toMatch(/no card/i);
    }
    // CONTROL: the live page offers no list, and so no such line — the check can fail.
    expect(interestWords("live").sub).not.toMatch(/no card/i);
  });

  it("once live, the early list is over: no 25%, and no promise of a code", () => {
    const live = interestWords("live");
    const said = [live.kicker, live.h1, live.sub, live.description, live.reassure, live.share, live.sent("Zz Pat", "zz@example.invalid")].join(" ");
    expect(said).not.toMatch(/25%|code|opens soon|opening soon/i);
    // CONTROL: the held words do carry it, so the line above can fail.
    expect(interestWords("held").sent("Zz Pat", "zz@example.invalid")).toMatch(/25% code/);
  });

  it("never the word the app does not say", () => {
    const all = JSON.stringify([INTEREST_COPY, interestWords("held"), interestWords("live")]).toLowerCase();
    expect(all).not.toContain("closed");
  });

  it("the email to inquiries@ sorts by who and where, at a glance", () => {
    expect(interestSubject({ name: "Zz Pat", club: "Zz Oakmere GC", role: INTEREST_ROLES[0].label, size: "50 to 150" })).toBe(
      "Interest: Club secretary or manager at Zz Oakmere GC (50 to 150) – Zz Pat",
    );
  });
});
