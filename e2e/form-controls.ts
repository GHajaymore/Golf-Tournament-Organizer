import type { BrowserContext, Page } from "@playwright/test";
import { scrub } from "./console-sweep";

/**
 * WHICH FORM CONTROLS A TEST HAS CHANGED, AND WHICH NONE HAS.
 *
 * The status board said "form controls tested: 382 of 711", added from a crawl
 * count and a count of the code (Oct 2026). This is the browser half of the script that replaces it:
 *
 *   - `controlsOn(page)`: every form control DRAWN on the page as it stands,
 *     as a role and an accessible name. The console sweep
 *     (`console-sweep.spec.ts`) calls it on each screen it measures; that is
 *     the INVENTORY, the bottom of the fraction.
 *   - `watchControls(context)`: every context of every spec (`coverage.ts`)
 *     listens for a control being CHANGED and says so once; that is the top.
 *
 * `scripts/qa/form-controls.mjs` joins the two and `scripts/e2e-coverage.mjs`
 * prints "form controls changed by a test: N of M". What M leaves out is said
 * there, on the line.
 *
 * ONE DESCRIPTION OF A CONTROL, USED BY BOTH. `installFormControls` runs in the
 * browser and is the only place that says what a control's role and name are,
 * so the sweep's inventory and a spec's change cannot name one box two ways.
 *
 *   WHAT IS A CONTROL: a drawn `select`, `textarea` or `input` (not `hidden`,
 *   `submit`, `button`, `reset`, `image`), and anything given the role
 *   `combobox`, `switch`, `checkbox` or `radio`.
 *   ITS ROLE: the `role` attribute when it is one a control has; else the
 *   element's own (`textbox`, `combobox`, `checkbox`, `radio`, `spinbutton`,
 *   `slider`, `searchbox`, `listbox`), or `input[date]`, `input[file]` and the
 *   like for the kinds with no better word.
 *   ITS NAME: `aria-label`, then `aria-labelledby`, then its `label` (the
 *   caption only: the words of a `select`'s own options are not its name),
 *   then its own words if it is not a native box, then `name`, `placeholder`,
 *   `title`. A radio also says its group, so "Yes" in two groups is two controls.
 *
 * WHAT COUNTS AS CHANGED: an `input` or `change` event on a control (what
 * `fill`, `selectOption`, `check`, `uncheck`, `setInputFiles`, typing and a
 * click on a tick-box or radio all end in), or a click on a switch, tick-box or
 * radio that is not a native box. With it goes what it was left as, where the
 * browser can say honestly: `filled` or `empty`; `refused` when the browser's
 * own check (`validity.valid`) says no; `on` or `off` for a native tick-box or
 * radio; `pressed` for a custom one, whose state is not known until the screen
 * redraws.
 * CANNOT SEE: a custom dropdown whose options are pressed, not typed (only
 * typing into it counts); a value set by script with no event; whether the
 * change was SAVED or read back. It measures, like the rest of `coverage.ts`.
 *
 * COST: two listeners, and one console line the first time each control on a
 * document is left in each state. `coverage.ts` writes a line to the ledger
 * once per worker, however many specs change that control.
 */

export const CONTROL_CHANGED = "[control changed] ";

/** How much of a signature is kept. Longer than the sweep's 70: see `scrub`. */
const SIGNATURE_LENGTH = 160;

export interface SeenControl {
  role: string;
  name: string;
  /** Disabled, `aria-disabled` or read-only as drawn: nobody could change it here. */
  off: boolean;
}

type Installed = { list: () => SeenControl[] };

/** Runs in the browser: self-contained, no closures. Safe to run twice. */
export function installFormControls(): void {
  const w = window as unknown as { __thqFormControls?: Installed };
  if (w.__thqFormControls) return;
  const SELECTOR = "input, select, textarea, [role=combobox], [role=switch], [role=checkbox], [role=radio]";
  const ROLES = ["combobox", "switch", "checkbox", "radio", "textbox", "searchbox", "spinbutton", "slider", "listbox"];
  const NOT_A_CONTROL = ["hidden", "submit", "button", "reset", "image"];
  const TEXT_TYPES = ["text", "email", "tel", "url", "password"];
  const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const native = (el: Element) => el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA";

  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute("role") ?? "";
    if (el.tagName === "INPUT" && NOT_A_CONTROL.includes((el as HTMLInputElement).type)) return "";
    // A wrapper given a role around a real box is not a second control: the box is the control.
    if (!native(el) && el.querySelector("input:not([type=hidden]), select, textarea")) return "";
    if (ROLES.includes(explicit)) return explicit;
    if (el.tagName === "SELECT") return (el as HTMLSelectElement).multiple ? "listbox" : "combobox";
    if (el.tagName === "TEXTAREA") return "textbox";
    if (el.tagName !== "INPUT") return "";
    const type = (el as HTMLInputElement).type;
    if (type === "checkbox" || type === "radio") return type;
    if (type === "number") return "spinbutton";
    if (type === "range") return "slider";
    if (type === "search") return "searchbox";
    return TEXT_TYPES.includes(type) ? "textbox" : `input[${type}]`;
  };

  // A label's caption without the boxes inside it: a select's options are not its name.
  const captionOf = (label: Element | null): string => {
    if (!label) return "";
    const copy = label.cloneNode(true) as Element;
    copy.querySelectorAll("select, input, textarea, button, [role=listbox]").forEach((x) => x.remove());
    return flat(copy.textContent);
  };
  const byIds = (ids: string | null) => flat((ids ?? "").split(/\s+/).filter(Boolean).map((i) => flat(document.getElementById(i)?.textContent)).join(" "));

  const nameOf = (el: Element): string => {
    const id = el.getAttribute("id");
    const own =
      flat(el.getAttribute("aria-label")) ||
      byIds(el.getAttribute("aria-labelledby")) ||
      (id ? captionOf(document.querySelector(`label[for="${CSS.escape(id)}"]`)) : "") ||
      captionOf(el.closest("label")) ||
      (native(el) ? "" : flat(el.textContent)) ||
      flat(el.getAttribute("name")) ||
      flat(el.getAttribute("placeholder")) ||
      flat(el.getAttribute("title"));
    let group = "";
    if (roleOf(el) === "radio") {
      const set = el.closest("[role=radiogroup], fieldset");
      group = set
        ? flat(set.getAttribute("aria-label")) || byIds(set.getAttribute("aria-labelledby")) || flat(set.querySelector("legend")?.textContent)
        : "";
      if (!group) group = flat(el.getAttribute("name"));
    }
    return (group && group !== own ? `${own} (in ${group})` : own).slice(0, 80);
  };

  const offOf = (el: Element): boolean =>
    el.matches(":disabled") || el.getAttribute("aria-disabled") === "true" || (el as HTMLInputElement).readOnly === true;

  const shown = (el: Element): boolean => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
    if (typeof check === "function" && !check.call(el, { visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // A segmented control's radio is drawn 0 by 0: what a person sees is its label (as the sweep's rule 2 has it).
  const drawn = (el: Element): boolean => {
    if (shown(el)) return true;
    const label = el.closest("label");
    return !!label && getComputedStyle(el).display !== "none" && shown(label);
  };

  const controlOf = (target: EventTarget | null): Element | null => {
    const el = target instanceof Element ? target.closest(SELECTOR) : null;
    return el && roleOf(el) ? el : null;
  };

  w.__thqFormControls = {
    list: () => {
      const out: SeenControl[] = [];
      for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
        const role = roleOf(el);
        if (!role || !drawn(el)) continue;
        out.push({ role, name: nameOf(el), off: offOf(el) });
      }
      return out;
    },
  };

  // What each element has already been reported as, so typing a word is one line and not one a letter.
  const told = new WeakMap<Element, Set<string>>();
  const tell = (el: Element, cls: string) => {
    let was = told.get(el);
    if (!was) told.set(el, (was = new Set()));
    if (was.has(cls)) return;
    was.add(cls);
    console.info("[control changed] " + JSON.stringify({ p: location.pathname, c: cls, r: roleOf(el), n: nameOf(el) }));
  };
  const changed = (e: Event) => {
    // AN INSTRUMENT NEVER THROWS INTO THE PAGE (see `watchRefusals`).
    try {
      const el = controlOf(e.target);
      if (!el || !native(el)) return;
      const box = el as HTMLInputElement;
      if (box.type === "checkbox" || box.type === "radio") return tell(el, box.checked ? "on" : "off");
      tell(el, box.value === "" ? "empty" : "filled");
      if (box.validity && !box.validity.valid) tell(el, "refused");
    } catch {
      /* said nothing: the report then under-counts, which is the safe way to be wrong */
    }
  };
  const pressed = (e: Event) => {
    try {
      const el = controlOf(e.target);
      if (!el || native(el) || offOf(el)) return;
      const role = roleOf(el);
      if (role === "switch" || role === "checkbox" || role === "radio") tell(el, "pressed");
    } catch {
      /* as above */
    }
  };
  document.addEventListener("input", changed, true);
  document.addEventListener("change", changed, true);
  document.addEventListener("click", pressed, true);
}

/** Every page of the context reports the controls changed on it. Called for every context in `coverage.ts`. */
export async function watchControls(context: BrowserContext): Promise<void> {
  await context.addInitScript(installFormControls);
}

/** The form controls drawn on the page as it stands. Reads only. */
export async function controlsOn(page: Page): Promise<SeenControl[]> {
  // The description is installed here too, so a page reached without the fixture's context is still read the same way.
  await page.evaluate(installFormControls);
  return page.evaluate(() => (window as unknown as { __thqFormControls: Installed }).__thqFormControls.list());
}

/**
 * A control's key: its role and its name, with the fixture's invented names,
 * database ids, figures and days taken out, exactly as the sweep's known list
 * has them (`scrub`). No name is known on the changing side, so none is taken
 * out there; the join lets `<name>` stand for any words.
 */
export function controlSignature(role: string, name: string, names: readonly string[] = []): string {
  return scrub(`${role} "${name}"`, names, SIGNATURE_LENGTH);
}

const screenOf = (pathname: string) => (pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname);

/** `S <stage> <path>`: the sweep measured this screen at this stage (so a screen with no control still counts as walked). */
export function screenLine(stage: string, pathname: string): string {
  return `S ${stage} ${screenOf(pathname)}`;
}

/** `I <stage> <path> | on|off | <sig>`: one control the sweep saw. */
export function inventoryLine(stage: string, pathname: string, control: SeenControl, names: readonly string[] = []): string {
  return `I ${stage} ${screenOf(pathname)} | ${control.off ? "off" : "on"} | ${controlSignature(control.role, control.name, names)}`;
}

/**
 * `C <path> | <class> | <sig>` from what the page said (the words after
 * `CONTROL_CHANGED`), or `null` when it is not ours: a page may print anything.
 */
export function changeLine(said: string): string | null {
  let row: { p?: unknown; c?: unknown; r?: unknown; n?: unknown };
  try {
    row = JSON.parse(said);
  } catch {
    return null;
  }
  if (!row || typeof row.p !== "string" || typeof row.c !== "string" || typeof row.r !== "string" || typeof row.n !== "string") return null;
  if (!row.p.startsWith("/") || !row.r || !/^[a-z]+$/.test(row.c)) return null;
  return `C ${screenOf(row.p)} | ${row.c} | ${controlSignature(row.r, row.n)}`;
}
