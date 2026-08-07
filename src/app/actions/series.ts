"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { organizationIdForEvent } from "@/lib/services/roster";
import { DEFAULT_POINTS_TABLE } from "@/lib/domain/series";

export interface SeriesResult {
  ok: boolean;
  error?: string;
  seriesId?: string;
}

/**
 * Organizer of the open tournament, plus the club that owns it.
 *
 * A season spans an organization rather than one event, so every action here
 * resolves the club from the session's tournament and scopes to it. Without
 * that, a series id from another club would be editable — every export in a
 * "use server" file is a public endpoint.
 */
async function requireOrg(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin") throw new Error("Organizer access required");
  const organizationId = await organizationIdForEvent(session.eventId);
  if (!organizationId) throw new Error("No organization for this tournament");
  return organizationId;
}

function refresh() {
  revalidatePath("/", "layout");
}

/** Parse a points table an organizer typed, e.g. "100, 80, 65". */
function parseTable(input: string): number[] | null {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/[,\s]+/).filter(Boolean).map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  // Descending is not enforced — a club is entitled to an odd scheme — but an
  // empty or nonsense list is rejected rather than silently defaulted, because
  // scoring a season on a table nobody meant is worse than refusing to save.
  return parts;
}

export async function createSeries(name: string): Promise<SeriesResult> {
  const organizationId = await requireOrg();
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Give the season a name." };
  const series = await prisma.series.create({
    data: { organizationId, name: clean, pointsTable: JSON.stringify(DEFAULT_POINTS_TABLE) },
  });
  refresh();
  return { ok: true, seriesId: series.id };
}

export interface SeriesPatch {
  name?: string;
  description?: string;
  /** As typed: "100, 80, 65". Empty falls back to the default table. */
  pointsTable?: string;
  bestOf?: number;
  minEvents?: number;
  status?: string;
}

export async function updateSeries(seriesId: string, patch: SeriesPatch): Promise<SeriesResult> {
  const organizationId = await requireOrg();
  const existing = await prisma.series.findFirst({ where: { id: seriesId, organizationId } });
  if (!existing) return { ok: false, error: "Season not found." };

  const data: Record<string, string | number> = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) return { ok: false, error: "Give the season a name." };
    data.name = patch.name.trim();
  }
  if (patch.description !== undefined) data.description = patch.description.trim();
  if (patch.pointsTable !== undefined) {
    const parsed = parseTable(patch.pointsTable);
    if (!parsed) return { ok: false, error: "Points must be numbers, like 100, 80, 65." };
    data.pointsTable = JSON.stringify(parsed);
  }
  if (patch.bestOf !== undefined) {
    if (!Number.isFinite(patch.bestOf) || patch.bestOf < 0) {
      return { ok: false, error: "Best-of must be 0 or more. 0 counts every round." };
    }
    data.bestOf = Math.round(patch.bestOf);
  }
  if (patch.minEvents !== undefined) {
    if (!Number.isFinite(patch.minEvents) || patch.minEvents < 0) {
      return { ok: false, error: "The minimum must be 0 or more. 0 ranks everyone." };
    }
    data.minEvents = Math.round(patch.minEvents);
  }
  if (patch.status !== undefined) data.status = patch.status === "complete" ? "complete" : "active";

  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.series.update({ where: { id: seriesId }, data });
  refresh();
  return { ok: true };
}

export async function deleteSeries(seriesId: string): Promise<SeriesResult> {
  const organizationId = await requireOrg();
  const existing = await prisma.series.findFirst({ where: { id: seriesId, organizationId } });
  if (!existing) return { ok: false, error: "Season not found." };
  // The foreign key nulls seriesId rather than cascading: a club winding up
  // its winter league still wants the rounds it played.
  await prisma.series.delete({ where: { id: seriesId } });
  refresh();
  return { ok: true };
}

/**
 * Put a tournament into a season, or take it out.
 *
 * Scoped to the same organization on both sides, so a tournament cannot be
 * entered into another club's order of merit.
 */
export async function setEventSeries(eventId: string, seriesId: string | null): Promise<SeriesResult> {
  const organizationId = await requireOrg();
  const event = await prisma.event.findFirst({ where: { id: eventId, organizationId } });
  if (!event) return { ok: false, error: "Tournament not found." };
  if (seriesId) {
    const series = await prisma.series.findFirst({ where: { id: seriesId, organizationId } });
    if (!series) return { ok: false, error: "Season not found." };
    if (series.status === "complete") {
      return { ok: false, error: `${series.name} is finished. Reopen it before adding rounds.` };
    }
  }
  await prisma.event.update({ where: { id: eventId }, data: { seriesId } });
  refresh();
  return { ok: true };
}
