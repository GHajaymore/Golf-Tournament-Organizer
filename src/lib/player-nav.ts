/**
 * THE PLAYER'S OWN SCREENS, AS DATA.
 *
 * The console has `NAV` in `nav.ts` and everything reads it — the sidebar, the
 * phone's tab bar, the touch-minimum sweep, and the browser tab via
 * `screenName`. The player's screens had no equivalent: their names lived
 * inside `PlayTabs.tsx` as a constant in a `"use client"` component, which is
 * fine for rendering a tab bar and unreachable from anything that runs on the
 * server.
 *
 * SO FIVE OF THE SIX PLAYER SCREENS HAD NO TITLE AT ALL. `/me` named itself
 * and the rest inherited the root layout's `title.default` — "TourneyHQ —
 * Golf tournament management, from the draw to the payout" — so the board, the
 * card, the money and the rules all read the same marketing sentence in the
 * browser tab. Walked as a player on 2026-09-11.
 *
 * That is the identical defect `screen-metadata.ts` was written for, fixed for
 * the twenty-one console screens and `/me` and never extended to the rest,
 * because the names were not anywhere a server component could read them. This
 * file is that fix: the list moves out of the component, `PlayTabs` renders
 * from it, and `screenName` finds it.
 *
 * WHY THE PLAYER'S LIST IS SEPARATE FROM `NAV` rather than four more rows in
 * it. `NAV` is the console — sectioned by the tournament lifecycle, filtered by
 * role, tiered for touch, relabelled for a casual round and for the kind of
 * outfit. None of that applies here: a player has four tabs, always the same
 * four, in one order, with no sections and no roles. Folding them in would mean
 * every one of those rules growing an exception, which is how a shared
 * abstraction becomes worse than two honest ones.
 */

export interface PlayerScreen {
  href: string;
  /** What the tab says, and what the browser tab says. One name. */
  label: string;
  icon: string;
  /**
   * The filled variant, for the tab the player is standing on.
   *
   * OPTIONAL, because a screen that is not a tab has no active state to draw.
   * Messages is reached from a header icon and never appears in the bar, so
   * giving it a filled variant meant naming an icon nothing renders — and
   * `icon-sprite.test.ts` caught exactly that, because the sprite holds only
   * what the source asks for. An unused name is a silent empty space waiting
   * for whoever makes Messages a tab; absent is the honest answer.
   *
   * (The filled name is deliberately not spelled out anywhere in this file.
   * The sprite generator scans source text and does not skip comments, so
   * writing it here would put it back into the sprite — a comment making a
   * thing true is the same hazard `source-guard.test.ts` records from the
   * other direction.)
   */
  iconActive?: string;
}

/**
 * Four tabs, and deliberately only four.
 *
 * The console's sidebar has fifteen entries because an organizer genuinely
 * does fifteen things. A player does four, and every extra one is something to
 * read past while standing on a tee. If a fifth is ever needed, something here
 * should have to leave.
 */
export const PLAYER_TABS: readonly PlayerScreen[] = [
  { href: "/me", label: "Today", icon: "ph ph-flag", iconActive: "ph-fill ph-flag" },
  { href: "/me/board", label: "Board", icon: "ph ph-ranking", iconActive: "ph-fill ph-ranking" },
  { href: "/me/card", label: "My card", icon: "ph ph-cards", iconActive: "ph-fill ph-cards" },
  { href: "/me/rules", label: "Rules", icon: "ph ph-book-open", iconActive: "ph-fill ph-book-open" },
];

/**
 * Money is the exception, and it earns it by being CONDITIONAL: it appears
 * only for a tournament that is actually splitting costs, so a Wednesday
 * league that never buys a round together still has four. Nothing had to
 * leave, and nobody is asked to read past a tab their event does not use.
 */
export const PLAYER_MONEY_TAB: PlayerScreen = {
  href: "/me/money",
  label: "Money",
  icon: "ph ph-receipt",
  iconActive: "ph-fill ph-receipt",
};

/**
 * MESSAGES is the other player destination and is deliberately NOT a tab. It
 * lives as an icon in the header, with an unread badge — which is where a chat
 * icon belongs and how every phone already does it. It is also the one screen a
 * player opens because something arrived rather than because they chose to go
 * there, and a badge answers that better than a tab.
 *
 * It is in this list all the same, because "not a tab" and "has no name" are
 * different claims and only the first is true: it is a real screen with a real
 * browser tab, and it inherited the marketing sentence along with the rest.
 */
export const PLAYER_MESSAGES: PlayerScreen = {
  href: "/me/messages",
  label: "Messages",
  icon: "ph ph-chat-circle-dots",
};

/** Every player screen, tab or not — the lookup `screenName` walks. */
export const ALL_PLAYER_SCREENS: readonly PlayerScreen[] = [
  ...PLAYER_TABS,
  PLAYER_MONEY_TAB,
  PLAYER_MESSAGES,
];
