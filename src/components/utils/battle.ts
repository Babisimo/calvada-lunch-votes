/**
 * ⚠ NOT WIRED UP — see the header of ClickBattle.tsx for why, and for the steps
 * to revive it. Nothing imports this, so it is tree-shaken out of the bundle.
 *
 * ---
 *
 * The click battle that settles a tied week.
 *
 * Shape, in Firestore:
 *
 *   tieBreakers/{weekKey}            options, endsAt, durationSec, decidedForEndMs
 *   tieBreakers/{weekKey}/clicks/{uid}   choice, count, updatedAt
 *
 * One document per player, never a shared counter — Firestore caps sustained
 * writes to a single document at roughly one per second, which two people
 * mashing would blow through instantly.
 *
 * Counts are ABSOLUTE, not increments. An increment() is opaque to security
 * rules; an absolute number can be held to monotonic growth and a rate cap.
 * See the tieBreakers block in firestore.rules.
 */

export type BattleConfig = {
  options: string[];
  endsAt: number;
  durationSec: number;
  decidedForEndMs: number;
};

export type ClickDoc = {
  choice: string;
  count: number;
};

/**
 * How often a player's buffered clicks are flushed to their doc.
 *
 * firestore.rules rejects writes less than 350ms apart, so this needs headroom
 * above that — network jitter on a 400ms interval was close enough to the limit
 * to trip it. A rejected flush is retried, not dropped, but retries cost writes.
 */
export const FLUSH_MS = 500;

/**
 * Must stay at or below the per-write cap in firestore.rules, or a fast
 * clicker's flush gets rejected and their clicks silently vanish.
 */
export const MAX_CLICKS_PER_FLUSH = 40;

/**
 * firestore.rules accepts click writes until `endsAt + 2000`, because the last
 * buffered flush necessarily lands after the whistle. Keep this in step with
 * the `+ 2000` in the tieBreakers block.
 */
export const FLUSH_GRACE_MS = 2000;

/**
 * How long after the whistle the result is computed. Must clear FLUSH_GRACE_MS,
 * or the winner gets decided from counts that are missing everyone's final
 * flush — which is precisely the half-second that decides a close battle.
 */
export const SETTLE_DELAY_MS = FLUSH_GRACE_MS + 500;

/** Totals per option, including options nobody clicked. */
export function battleTally(options: string[], clicks: ClickDoc[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const option of options) tally[option] = 0;

  for (const click of clicks) {
    if (!(click.choice in tally)) continue; // option left the ballot mid-battle
    tally[click.choice] += Math.max(0, click.count || 0);
  }

  return tally;
}

/**
 * Who won the battle.
 *
 * `null` means it cannot be settled by clicking — either nobody clicked at all,
 * or the top is still level. Both fall through to the coin flip, which is the
 * only mechanism that can break a deadlock without agreement.
 */
export function battleWinner(tally: Record<string, number>): string | null {
  const entries = Object.entries(tally);
  if (entries.length === 0) return null;

  const max = Math.max(...entries.map(([, n]) => n));
  if (max <= 0) return null; // nobody showed up

  const top = entries.filter(([, n]) => n === max);
  if (top.length > 1) return null; // still tied, even after all that

  return top[0][0];
}
