"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SettingsSection } from "./SettingsNav";
import { readsAsRefusal, tabAfterKey, tabFromHash } from "@/lib/settings-tabs";

/**
 * A LONG SETTINGS SCREEN, ONE SECTION AT A TIME.
 *
 * Club settings was seven sections stacked — about nine phone screens — under a
 * sticky row of jump links (`SettingsNav`). Ajay, 2026-10-21: "go with your
 * recommendations and change the structure as needed". The same row is a row
 * of TABS now, and only the section chosen is shown.
 *
 * `SettingsNav`'s header gives the reason a long page was not simply folded
 * up, and the reason still holds: several sections hold an unsaved draft
 * behind a Save button, and a disclosure that UNMOUNTS its children throws the
 * draft away without a word. So nothing here unmounts. Every section is in the
 * page from the first byte, and the ones not chosen carry `hidden` — a draft
 * typed into Money is there when you come back from Colour, and
 * `e2e/club-settings-tabs.spec.ts` types one and goes round to prove it.
 *
 * THE HASH IS THE TAB. `/organization#plan` is what every other screen, the
 * billing return and the join email already link to, so it picks the tab, and
 * changing the hash changes the tab. A hash the page does not know is the
 * first section. The server cannot see a hash, so it draws the first section
 * and hides the rest — a deep link opens on the first section for the moment
 * before the script runs, never on all seven at once.
 *
 * A REFUSAL IS SAID WHERE THE PRESS WAS (CLAUDE.md). It can now be said where
 * the person no longer is: press Save in Money, tap Colour before the answer
 * comes back, and the refusal is drawn inside a hidden section. So a hidden
 * section that draws one marks its tab, and opening the tab brings the
 * refusal into view, once. What counts as a refusal is the rule
 * `e2e/coverage.ts` watches every press with: something marked as one, or a
 * sentence in the danger colour.
 */

interface TabsState {
  selected: string;
  flag: (id: string, el: HTMLElement) => void;
}

const TabsContext = createContext<TabsState | null>(null);

/** The id the tab for a section carries, for `aria-labelledby`. */
const tabId = (id: string) => `tab-${id}`;

export function SettingsTabs({
  sections,
  label,
  children,
}: {
  sections: readonly SettingsSection[];
  /** What the row of tabs is, for a screen reader: "Club settings sections". */
  label: string;
  children: React.ReactNode;
}) {
  const ids = useMemo(() => sections.map((s) => s.id), [sections]);
  // The first section, on the server and on the first client render alike, so
  // the two agree; the hash is read once the page is live.
  const [selected, setSelected] = useState(ids[0] ?? "");
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
  /** The refusal waiting in each marked section, to bring into view when it is opened. */
  const waiting = useRef(new Map<string, HTMLElement>());
  /** Set when the next selection should be brought into view (it came from a link, or a tab was pressed). */
  const reveal = useRef(false);
  const tabs = useRef<Array<HTMLAnchorElement | null>>([]);

  const flag = useCallback((id: string, el: HTMLElement) => {
    waiting.current.set(id, el);
    setFlagged((now) => (now.has(id) ? now : new Set(now).add(id)));
  }, []);

  const select = useCallback(
    (id: string) => {
      reveal.current = true;
      setSelected(id);
      if (typeof window !== "undefined" && window.location.hash !== `#${id}`) {
        // Replace, not push: Back leaves the screen rather than walking back
        // through every tab looked at. `history.state` is kept because it is
        // the router's.
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${id}`);
      }
    },
    [],
  );

  // The hash picks the tab: on arrival, on Back and Forward, and on a link to
  // a section of this same screen — which the router follows with pushState,
  // where no `hashchange` fires, so a click anywhere is followed by a look.
  useEffect(() => {
    const fromHash = (fromLink: boolean) => {
      const next = tabFromHash(window.location.hash, ids);
      setSelected((now) => {
        if (now !== next && fromLink) reveal.current = true;
        return next;
      });
    };
    fromHash(false);
    const onHash = () => fromHash(true);
    // The router writes the address when it commits, which can be a moment
    // after the click, so it is looked at again a little later as well.
    let timers: Array<ReturnType<typeof setTimeout>> = [];
    const onClick = () => {
      timers.forEach(clearTimeout);
      timers = [0, 60, 300].map((ms) => setTimeout(() => fromHash(true), ms));
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    document.addEventListener("click", onClick);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
      document.removeEventListener("click", onClick);
    };
  }, [ids]);

  // Once a section is shown: its mark comes off, and what it was waiting to say
  // is brought into view — or, failing that, the top of the section, if the
  // reader had scrolled past it with the bar stuck above them.
  useEffect(() => {
    const said = waiting.current.get(selected);
    if (said) {
      waiting.current.delete(selected);
      setFlagged((now) => {
        if (!now.has(selected)) return now;
        const next = new Set(now);
        next.delete(selected);
        return next;
      });
      if (said.isConnected) {
        said.scrollIntoView({ block: "center" });
        reveal.current = false;
        return;
      }
    }
    if (!reveal.current) return;
    reveal.current = false;
    const panel = document.getElementById(selected);
    if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: "start" });
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>, index: number) => {
    const next = tabAfterKey(e.key, index, ids.length);
    if (next === null) return;
    e.preventDefault();
    select(ids[next]);
    tabs.current[next]?.focus();
  };

  const state = useMemo(() => ({ selected, flag }), [selected, flag]);

  return (
    <TabsContext.Provider value={state}>
      <nav
        aria-label="Sections on this page"
        className="card elev-sm"
        style={{
          // Sticky, as the jump links were: the question "where else can I
          // go" is still asked from half way down a long section.
          position: "sticky",
          top: 0,
          zIndex: 2,
          marginBottom: 16,
          gap: 8,
        }}
      >
        <span className="card-kicker">On this page</span>
        {/* Scrolls sideways inside itself at narrow widths rather than
            wrapping into rows of chips; the page body never scrolls sideways. */}
        <div style={{ overflowX: "auto", margin: "0 -2px", padding: "0 2px" }}>
          <div
            role="tablist"
            aria-label={label}
            style={{ display: "flex", gap: 6, minWidth: "min-content" }}
          >
            {sections.map((s, i) => {
              const on = s.id === selected;
              const marked = flagged.has(s.id);
              return (
                // A LINK TO THE SECTION, playing a tab. Pressed before the
                // page's script has arrived — a course's signal, a slow
                // laptop — it still changes the hash, and the hash is read the
                // moment the script runs; a bare button would do nothing.
                <a
                  key={s.id}
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  href={`#${s.id}`}
                  role="tab"
                  id={tabId(s.id)}
                  aria-selected={on}
                  aria-controls={s.id}
                  // One stop in the Tab order for the whole row; the arrows
                  // move along it (the WAI-ARIA tabs pattern).
                  tabIndex={on ? 0 : -1}
                  data-refused={marked ? "" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    select(s.id);
                  }}
                  onKeyDown={(e) => {
                    // Space presses a tab as it presses a button.
                    if (e.key === " ") {
                      e.preventDefault();
                      select(s.id);
                      return;
                    }
                    onKeyDown(e, i);
                  }}
                  style={{
                    textDecoration: "none",
                    flex: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    minHeight: 44,
                    padding: "7px 11px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    // The chosen tab is filled as a primary button is (accent
                    // 300, its label 7.5:1 at worst); the rest are the chips
                    // the jump links were.
                    color: on ? "var(--color-on-accent)" : "var(--color-text)",
                    background: on ? "var(--color-accent-300)" : "transparent",
                    border: on ? "1px solid transparent" : "1px solid var(--color-divider)",
                  }}
                >
                  {s.label}
                  {s.count ? (
                    <>
                      <span
                        aria-hidden
                        style={{
                          minWidth: 20,
                          padding: "0 6px",
                          borderRadius: 999,
                          fontSize: 13,
                          lineHeight: "20px",
                          textAlign: "center",
                          // The reverse of the tab it sits on, so it reads on both.
                          color: on ? "var(--color-text)" : "var(--color-on-accent)",
                          background: on ? "var(--color-surface)" : "var(--color-accent-300)",
                        }}
                      >
                        {s.count}
                      </span>
                      <span className="sr-only"> ({s.count} waiting)</span>
                    </>
                  ) : null}
                  {marked && (
                    <>
                      <span
                        aria-hidden
                        style={{ width: 8, height: 8, borderRadius: 999, background: "var(--color-danger)", flex: "none" }}
                      />
                      <span className="sr-only">, has a message for you</span>
                    </>
                  )}
                </a>
              );
            })}
          </div>
        </div>
      </nav>
      {children}
    </TabsContext.Provider>
  );
}

/** The danger colour as it is drawn WHERE an element is: a club's look is hung on the screen's own wrapper. */
function dangerColourAt(el: HTMLElement): string {
  const probe = document.createElement("span");
  probe.style.color = "var(--color-danger)";
  (el.parentElement ?? document.body).appendChild(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

/** A refusal in what was just drawn, if there is one. See the header. */
function refusalIn(node: Node): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node.parentElement;
  if (!el) return null;
  const candidates = [el, ...Array.from(el.querySelectorAll<HTMLElement>('[role="alert"], .form-error, p, span, div')).slice(0, 40)];
  for (const c of candidates) {
    const words = c.textContent ?? "";
    if (c.matches('[role="alert"], .form-error')) {
      if (words.trim()) return c;
      continue;
    }
    if (!/^(P|SPAN|DIV)$/.test(c.tagName) || c.children.length > 2 || c.closest("button, a, table")) continue;
    if (!readsAsRefusal(words)) continue;
    if (getComputedStyle(c).color === dangerColourAt(c)) return c;
  }
  return null;
}

export function SettingsTabPanel({ id, children }: { id: string; children: React.ReactNode }) {
  const tabsState = useContext(TabsContext);
  if (!tabsState) throw new Error("SettingsTabPanel must sit inside SettingsTabs");
  const { selected, flag } = tabsState;
  const hidden = selected !== id;
  const ref = useRef<HTMLElement>(null);

  // While hidden, watch for a refusal arriving — the answer to a press made
  // before the person moved to another tab.
  useEffect(() => {
    const panel = ref.current;
    if (!hidden || !panel) return;
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        const touched = r.type === "characterData" ? [r.target] : Array.from(r.addedNodes);
        for (const n of touched) {
          const said = refusalIn(n);
          if (said) {
            flag(id, said);
            return;
          }
        }
      }
    });
    watch.observe(panel, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [hidden, id, flag]);

  return (
    <section
      ref={ref}
      id={id}
      role="tabpanel"
      aria-labelledby={tabId(id)}
      // HIDDEN, NEVER UNMOUNTED: see the header. A draft lives in here.
      hidden={hidden}
      // Clear of the sticky bar when a section is brought into view.
      style={{ marginTop: 16, scrollMarginTop: 118 }}
    >
      {children}
    </section>
  );
}
