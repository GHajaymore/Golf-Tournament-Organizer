import { prisma } from "@/lib/db";

/**
 * What a player's "Who would you like to play with?" card needs: the rest of
 * the confirmed field, alphabetically, and who they have already asked for
 * (dropping anybody who has since left the field).
 */
export async function playWithFor(
  eventId: string,
  playerId: string,
): Promise<{ others: { id: string; name: string }[]; chosen: string[] }> {
  const field = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    select: { id: true, name: true, playWith: true },
  });
  const me = field.find((p) => p.id === playerId);
  const others = field
    .filter((p) => p.id !== playerId)
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const inField = new Set(others.map((p) => p.id));
  return { others, chosen: (me?.playWith ?? []).filter((id) => inField.has(id)) };
}
