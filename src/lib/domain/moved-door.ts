import { relocate, type OldLink, type ScreenKey } from "./console-merges";
import { consoleUrl, type ConsoleMode } from "../console-url";

/**
 * WHERE A DASHBOARD DOOR LEADS NOW, THE PREVIEW KEPT (B106, B123). The one place a card turns an old address into its room's:
 * `relocate` decides whether the door moved (the screens shown), and a door that moved stays inside the preview it was pressed in.
 * `moved` is false when the door is today's, so a card can keep its own press (the dashboard's "Close Round n" button) exactly then.
 */
export function movedDoor(link: OldLink, shown: ReadonlySet<ScreenKey> | undefined, previewMode: ConsoleMode | null | undefined): { href: string; moved: boolean } {
  const to = shown ? relocate(link, shown) : link.href;
  const moved = to !== link.href;
  return { href: previewMode && moved ? consoleUrl(to, previewMode) : to, moved };
}
