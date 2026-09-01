/**
 * Tie detection, in one place.
 *
 * This repo previously carried THREE different tiebreak implementations that
 * disagreed with each other — ballot order in Leaderboard.tsx, ballot order in
 * functions/index.js, and Math.random() in a dead services/winner.tsx. Ties are
 * now resolved by an admin coin flip instead, and the only thing the code has
 * to agree on is *whether* a tie exists. That lives here so it can't fork again.
 */

export type TallyRow = { choice: string; count: number };

/**
 * The choices sharing the top count.
 *
 *   []            no votes yet — there is nothing to tie
 *   ['Al Pastor'] a clear winner
 *   ['a', 'b']    a tie, which nothing resolves automatically
 *
 * Order follows the input, so callers get a stable list to display.
 */
export function topTie(results: TallyRow[]): string[] {
  if (!results.length) return [];

  const max = Math.max(...results.map((r) => r.count));
  if (max <= 0) return [];

  return results.filter((r) => r.count === max).map((r) => r.choice);
}

/**
 * Pick one option at random for the coin flip.
 *
 * Unlike the old Math.random() tiebreak this is safe, because it runs exactly
 * once in the admin's browser and the result is written down. Nothing else
 * recomputes it, so there is nothing for two clients to disagree about.
 *
 * crypto.getRandomValues where available — a lunch vote does not need it, but
 * "the computer flipped a coin" is easier to defend when the coin is fair.
 */
export function flipPick<T>(options: T[]): T {
  if (options.length === 0) throw new Error('flipPick needs at least one option');
  if (options.length === 1) return options[0];

  let fraction: number;
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    fraction = buf[0] / 2 ** 32;
  } catch {
    fraction = Math.random();
  }

  // Guard the 1.0 edge so the index can never land past the end.
  const index = Math.min(options.length - 1, Math.floor(fraction * options.length));
  return options[index];
}
