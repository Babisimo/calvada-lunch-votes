/**
 * The app's week key is set by hand (useWeekKey deliberately has no fallback).
 * That means forgetting to roll it over shows everyone an empty ballot with no
 * explanation. This computes what today's key *should* be so the admin
 * dashboard can say so out loud.
 */
export function currentIsoWeekKey(at: Date = new Date()): string {
  const target = new Date(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()));
  // ISO weeks run Monday–Sunday and are numbered by the Thursday they contain.
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
