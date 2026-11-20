import { readFileSync } from "node:fs";
import { test, expect, ledgerFile } from "./coverage";
import { controlsOn, inventoryLine, screenLine, controlSignature } from "./form-controls";
import { joinFormControls } from "../scripts/qa/form-controls.mjs";

/**
 * CONTROL ON THE FORM-CONTROL MEASURE: a page with controls on it, one of them
 * changed, and the ledger must hold exactly that one.
 *
 * "form controls changed by a test: N of M" (`scripts/e2e-coverage.mjs`) is made
 * of two instruments, and neither is worth anything unproved:
 *
 *   - the INVENTORY (`controlsOn`), which must see every drawn control, once,
 *     by a name a person would know it by, and must not see what is not drawn;
 *   - the HOOK (`watchControls`, on every context through `coverage.ts`), which
 *     must write down a control a spec changed and nothing a spec only looked
 *     at, focused or pressed past.
 *
 * So this hands them a page written here, with no app in it, and reads the
 * worker's own ledger file back. A hook that recorded nothing would make every
 * figure 0 of M; one that recorded everything would make it M of M. Both look
 * like a measurement.
 *
 * THE PAGE IS SERVED, NOT SET: `page.setContent` rewrites the document in
 * place, which drops the listeners an init script put on it, so the hook would
 * be deaf on exactly the page meant to prove it. A route answers an address
 * with the markup instead, and the page arrives as any screen does. Nothing
 * reaches the server, nothing is saved, and it reads no fixture.
 *
 * Runs on every engine and size: the hook is on every context, and an engine
 * that fires its events differently is exactly what this is here to say.
 */
// An address of its own each time it runs: a worker writes a control's line once, so a second run in
// the same worker (a burn-in, `--repeat-each`) would otherwise find its lines already there.
const WHERE = `/zz-form-controls-control-${Date.now().toString(36)}`;

const PAGE = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title>
<style>body { margin: 0; font: 14px sans-serif; } input, select, button { min-height: 34px; } .seg input { position: absolute; width: 0; height: 0; opacity: 0; }</style></head>
<body><main><h1>t</h1>
  <label for="a">Changed box</label><input id="a" type="text">
  <label>Untouched box <input type="text"></label>
  <label>Format <select><option value="">Choose</option><option value="medal">Medal</option><option value="stableford">Stableford</option></select></label>
  <label><input type="checkbox"> Publish the draw</label>
  <fieldset><legend>Scoring</legend>
    <label class="seg"><input type="radio" name="scoring" value="gross"> Gross</label>
    <label class="seg"><input type="radio" name="scoring" value="net"> Net</label>
  </fieldset>
  <button type="button" role="switch" aria-checked="false" aria-label="Late entries">Off</button>
  <label>Field size <input type="number" min="2" max="144"></label>
  <label>Locked box <input type="text" disabled></label>
  <input type="hidden" name="secret" value="1">
  <input type="text" aria-label="Not drawn" style="display: none">
  <input type="submit" value="Send">
  <button type="button">Just a button</button>
</main></body></html>`;

/** This page's lines in this worker's ledger, as written. */
const written = (): string[] => {
  let all = "";
  try {
    all = readFileSync(ledgerFile(), "utf8");
  } catch {
    return [];
  }
  return all.split("\n").filter((line) => line.startsWith(`C ${WHERE} | `)).sort();
};

test("CONTROL: the inventory sees each drawn control once, and the ledger holds exactly the ones changed", async ({ page }) => {
  await page.route(`**${WHERE}`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: PAGE }));
  await page.goto(WHERE);
  await expect(page.getByRole("heading", { name: "t" })).toBeVisible();

  // THE INVENTORY. Not the hidden box, the one not drawn, the submit or the plain button; the
  // select by its caption and not its options; a radio drawn 0 by 0 by its label, with its group.
  const seen = await controlsOn(page);
  expect(seen.map((c) => `${c.off ? "off" : "on"} ${controlSignature(c.role, c.name)}`).sort()).toEqual(
    [
      'on textbox "Changed box"',
      'on textbox "Untouched box"',
      'on combobox "Format"',
      'on checkbox "Publish the draw"',
      'on radio "Gross (in Scoring)"',
      'on radio "Net (in Scoring)"',
      'on switch "Late entries"',
      'on spinbutton "Field size"',
      'off textbox "Locked box"',
    ].sort(),
  );
  const inventory = [screenLine("control", WHERE), ...seen.map((c) => inventoryLine("control", WHERE, c))];

  // Looked at, focused and pressed past: nothing changed, so nothing is written. (Checked again at
  // the end, after the hook is known to be hearing, so this is not a hook that hears nothing.)
  await page.getByLabel("Untouched box").focus();
  await page.getByRole("button", { name: "Just a button" }).click();

  // ONE control changed: exactly that one line, and the figure is 1 of 8 (the locked box is not in M).
  await page.getByLabel("Changed box").fill("Saturday medal");
  await expect.poll(written, { message: "the hook wrote nothing for a box that was filled" }).toEqual([`C ${WHERE} | filled | textbox "Changed box"`]);
  const one = joinFormControls([...inventory, ...written()]);
  expect({ changed: one.changed, total: one.total, neverEnabled: one.neverEnabled }).toEqual({ changed: 1, total: 8, neverEnabled: 1 });
  expect(one.screens[0].neverChanged).toContain('textbox "Untouched box"');

  // EACH WAY A SPEC CHANGES A CONTROL, and what it is left as.
  await page.getByLabel("Changed box").fill("");
  await page.getByLabel("Format").selectOption("stableford");
  await page.getByLabel("Publish the draw").check();
  await page.getByLabel("Publish the draw").uncheck();
  await page.getByText("Net", { exact: true }).click();
  await page.getByRole("switch", { name: "Late entries" }).click();
  // 500 is past the box's own max: the browser's check says no, and that is the only "refused" there is.
  await page.getByLabel("Field size").fill("500");
  await expect
    .poll(written, { message: "a way of changing a control was not heard" })
    .toEqual(
      [
        `C ${WHERE} | filled | textbox "Changed box"`,
        `C ${WHERE} | empty | textbox "Changed box"`,
        `C ${WHERE} | filled | combobox "Format"`,
        `C ${WHERE} | on | checkbox "Publish the draw"`,
        `C ${WHERE} | off | checkbox "Publish the draw"`,
        `C ${WHERE} | on | radio "Net (in Scoring)"`,
        `C ${WHERE} | pressed | switch "Late entries"`,
        `C ${WHERE} | filled | spinbutton "Field size"`,
        `C ${WHERE} | refused | spinbutton "Field size"`,
      ].sort(),
    );

  // And what was never changed is still named: the box only focused, and the radio not chosen.
  const all = joinFormControls([...inventory, ...written()]);
  expect({ changed: all.changed, total: all.total }).toEqual({ changed: 6, total: 8 });
  expect(all.screens[0].neverChanged).toEqual(['radio "Gross (in Scoring)"', 'textbox "Untouched box"']);
});
