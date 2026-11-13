import { getSession } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { dayOfInstant, monthOfInstant } from "@/lib/domain/finance";
import { toCsv } from "@/lib/domain/csv-export";
import { financeCsvRows } from "@/lib/services/owner-finance";

/**
 * THE FINANCE TAB'S CSV (B44): the rows behind the cost table, for the owners only. A stranger, a club
 * Admin, a pilot on SIGNIN_ALLOW_EMAILS and a signed-out visitor all get the 404 the console gives. No club,
 * no player, no id that names one is in it; free text is made safe for a spreadsheet (`csvCell`, the one escaper). Never cached.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return new Response("Not found", { status: 404 });
  const now = new Date();
  const body = toCsv(await financeCsvRows(monthOfInstant(now))) + "\r\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="tourneyhq-finance-${dayOfInstant(now)}.csv"`,
    },
  });
}
