"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { loadEventState, computeHighlights } from "@/lib/services/tournament";
import { entitlementForEvent } from "@/lib/services/entitlements";
import { askClaude } from "@/lib/services/claude";

async function requireStaff() {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") throw new Error("Organizer access required");
  return session;
}

export async function postCommentary(text: string, source = "organizer") {
  const session = await requireStaff();
  const clean = text.trim();
  if (!clean) return;
  await prisma.commentary.create({
    data: {
      eventId: session.eventId,
      author: session.name,
      text: clean.slice(0, 500),
      source: source === "ai" ? "ai" : "organizer",
    },
  });
  revalidatePath("/", "layout");
}

export async function deleteCommentary(id: string) {
  const session = await requireStaff();
  await prisma.commentary.deleteMany({ where: { id, eventId: session.eventId } });
  revalidatePath("/", "layout");
}

/**
 * Draft a commentary line from live tournament data using the Claude API.
 * Requires ANTHROPIC_API_KEY; without it, returns a clear "not configured"
 * result so the organizer can still write commentary by hand.
 */
export async function suggestCommentary(): Promise<{ text: string; configured: boolean }> {
  const session = await requireStaff();
  // Reported as "not configured" because that is exactly what the caller does
  // with it — hide the button and let the organizer write it themselves. This
  // action returns no error channel, so the plan check folds into the same
  // flag rather than inventing one. Gated because each draft costs money.
  const entitled = await entitlementForEvent(session.eventId, "aiAssist");
  if (!entitled.allowed) return { text: "", configured: false };

  const key = process.env.ANTHROPIC_API_KEY;
  const state = await loadEventState(session.eventId);
  if (!state) return { text: "", configured: !!key };

  const highlights = computeHighlights(state)
    .map((h) => `- ${h.title}: ${h.text}`)
    .join("\n");
  const top = state.overall
    .slice(0, 5)
    .map((r, i) => `${i + 1}. ${r.player.name} ${r.stats.wins}-${r.stats.ties}-${r.stats.losses}, ${Math.round(r.stats.totalPoints * 10) / 10} pts`)
    .join("\n");

  if (!key) {
    return {
      text: `AI drafting is off. Set ANTHROPIC_API_KEY to enable it. Meanwhile, here's the data:\n${highlights || "No highlights yet."}`,
      configured: false,
    };
  }

  const prompt = `You are a golf tournament commentator for "${state.event.name}". Write ONE short, punchy live-update line (max 30 words), energetic but factual, no hashtags. Use this data:\n\nStandings:\n${top}\n\nHighlights:\n${highlights}`;

  const answer = await askClaude({ model: "claude-sonnet-5", maxTokens: 120, content: prompt });
  if (answer.ok) return { text: answer.text, configured: true };
  if (answer.reason === "unreachable") return { text: "Could not reach the Claude API.", configured: true };
  // An empty reply is not an error to show a commentator — there is simply
  // nothing to say yet, and a line reading "nothing came back" on a public
  // board is worse than no line.
  if (answer.reason === "empty") return { text: "", configured: true };
  if (answer.reason === "not-configured") return { text: "", configured: false };
  return { text: `Claude API error (${answer.status}). Check the key.`, configured: true };
}
