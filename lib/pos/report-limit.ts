/** A capped query cannot establish a complete report; do not present its totals as complete. */
export class ReportLimitError extends Error {
  constructor() {
    super("This report reached its 5,000-record safety limit and may be incomplete. Choose a shorter period or contact support. No totals are shown.");
  }
}
