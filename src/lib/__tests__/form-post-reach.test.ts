import { describe, it, expect } from "vitest";
import { actionsInFormPost } from "../../../e2e/form-post-action";
import { readSource } from "./source";

/**
 * A FORM POSTED WITHOUT THE PAGE'S SCRIPT STILL COUNTS AS REACHING ITS ACTION (2026-11-03).
 *
 * Round G421-1 reported `redeemRoundCodeForm` and `claimPlayerSlotForm` as called by no screen
 * test, while `round-code-before-the-script.spec.ts` posted both: the reach ledger only read the
 * `next-action` header, which a plain post does not send. The body below is the one WebKit sent in
 * that round's trace (the boundary and action key as they were; the code invented).
 */
const B = "----WebKitFormBoundary0zGMMPOLBr7DuD2E";
const part = (name: string, value: string) => `--${B}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
const BOUND = [
  part("$ACTION_REF_1", ""),
  part("$ACTION_1:0", '{"id":"6051329710db0563b2a5eb49a6f5df825a2658b3f9","bound":"$@1"}'),
  part("$ACTION_1:1", "[null]"),
  part("$ACTION_KEY", "kba8f1e94fcd5e86673a307a4af298685"),
  part("code", "ZZQQQQQQ"),
].join("") + `--${B}--\r\n`;

describe("the action a plain form post calls", () => {
  it("is read from a bound action's reference, as the round-code forms send it", () => {
    expect(actionsInFormPost(BOUND)).toEqual(["6051329710db0563b2a5eb49a6f5df825a2658b3f9"]);
  });

  it("is read from an unbound action's field name, multipart or urlencoded", () => {
    const id = "00aa11bb22cc33dd44ee55ff66778899aabbccddee";
    expect(actionsInFormPost(part(`$ACTION_ID_${id}`, "") + part("name", "x") + `--${B}--\r\n`)).toEqual([id]);
    expect(actionsInFormPost(`${encodeURIComponent(`$ACTION_ID_${id}`)}=&name=x`)).toEqual([id]);
  });

  it("CONTROL: a form post that calls no action, and no body at all, record nothing", () => {
    expect(actionsInFormPost(part("code", '{"id":"6051329710db0563b2a5eb49a6f5df825a2658b3f9"}') + `--${B}--\r\n`)).toEqual([]);
    expect(actionsInFormPost("email=a%40example.invalid")).toEqual([]);
    expect(actionsInFormPost(null)).toEqual([]);
  });

  it("the ledger asks it of every POST that carries no next-action header", () => {
    const coverage = readSource("e2e/coverage.ts");
    expect(coverage).toMatch(/actionsInFormPost\(/);
    expect(coverage).toMatch(/request\.method\(\) === "POST"/);
  });
});
