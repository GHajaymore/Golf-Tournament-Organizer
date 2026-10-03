import { describe, it, expect } from "vitest";
import { accountDeletionRefusal } from "../account-deletion";

const base = { email: "zz-me@example.invalid", typedEmail: "zz-me@example.invalid", soleOwnerOf: [] as string[] };

describe("who may delete their own account", () => {
  it("anyone, typing their own email address", () => {
    expect(accountDeletionRefusal(base)).toBeNull();
  });

  it("the address is compared as an address: case and edge spaces do not matter", () => {
    expect(accountDeletionRefusal({ ...base, typedEmail: "  ZZ-Me@Example.Invalid " })).toBeNull();
  });

  it("not on a different address, a near miss, or nothing", () => {
    for (const typed of ["", "zz-me@example.invali", "zz-you@example.invalid", "zz-me"]) {
      expect(accountDeletionRefusal({ ...base, typedEmail: typed }), typed).toMatch(/Type your account's email/);
    }
  });

  it("never the last owner of a club — it would be left with nobody to run it", () => {
    expect(accountDeletionRefusal({ ...base, soleOwnerOf: ["ZZ Fairway Society"] })).toMatch(
      /only owner of ZZ Fairway Society\. Give it another owner/,
    );
    expect(accountDeletionRefusal({ ...base, soleOwnerOf: ["ZZ One", "ZZ Two"] })).toMatch(
      /only owner of ZZ One, ZZ Two\. Give each of them another owner/,
    );
  });
});
