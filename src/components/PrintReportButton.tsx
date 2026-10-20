"use client";
import { Icon } from "./Icon";

/**
 * Print the final report, or save it as a PDF from the print dialog. The
 * report has its own print styles (`report-styles.ts`), and a club on the free
 * plan keeps its report this way before completing deletes the tournament.
 */
export function PrintReportButton() {
  return (
    <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => window.print()}>
      <Icon name="printer" /> Print or save as PDF
    </button>
  );
}
