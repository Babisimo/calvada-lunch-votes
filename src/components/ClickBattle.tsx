import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { battleTally, FLUSH_MS, MAX_CLICKS_PER_FLUSH, type BattleConfig } from './utils/battle';
import { cn } from './ui/styles';

/**
 * ⚠ NOT WIRED UP. Kept deliberately, not dead code left by accident.
 *
 * The click battle was built, tested against live Firestore and then pulled:
 * it was fun but it turned settling a lunch vote into an event. Ties are
 * settled by the coin flip in AdminTieBreaker.tsx instead. Nothing imports this
 * file, so it is tree-shaken out of the bundle and costs production nothing.
 *
 * TO BRING IT BACK, in Leaderboard.tsx:
 *   1. subscribe to `tieBreakers/{weekKey}` into a `battle` state
 *   2. render <ClickBattle> while `battle.decidedForEndMs === endTimeMs` and
 *      the week is still `awaitingFlip`
 *   3. once `now >= battle.endsAt + SETTLE_DELAY_MS`, tally the clicks with
 *      battleTally/battleWinner and write the winner — a null result means
 *      nobody clicked or it ended level, and falls through to the coin flip
 * and in AdminTieBreaker.tsx, a seconds input that writes the battle document.
 *
 * The `tieBreakers` rules are already deployed, so reviving it needs no rules
 * change. See utils/battle.ts and the tieBreakers block in firestore.rules.
 *
 * ---
 *
 * The arena. Two (or more) tied options, a countdown, and everyone mashing.
 *
 * Clicks do NOT write straight through. They land in a ref and flush every
 * FLUSH_MS to this player's own document. A write per click would push a
 * snapshot to every listener per click — a 20-second battle with ten people
 * would burn roughly a fifth of the daily free-tier READ quota, and once that
 * runs out voting itself starts failing, not just the game.
 *
 * The consequence to know: your own number is local and instant, everyone
 * else's lags by up to FLUSH_MS. That is the right trade — the button must feel
 * immediate, the scoreboard does not.
 */
export default function ClickBattle({
  weekKey,
  battle,
  uid,
}: {
  weekKey: string;
  battle: BattleConfig;
  uid: string;
}) {
  const [side, setSide] = useState<string | null>(null);
  const [myCount, setMyCount] = useState(0);
  const [remote, setRemote] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());

  // Buffered clicks not yet written, and the last count we successfully wrote.
  const pendingRef = useRef(0);
  const writtenRef = useRef(0);
  const sideRef = useRef<string | null>(null);
  const flushingRef = useRef(false);

  const msLeft = Math.max(0, battle.endsAt - now);
  const live = msLeft > 0;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  // EVERYONE ELSE's clicks. Our own document is deliberately excluded.
  //
  // Mixing the server's echo of our own count with our unwritten local clicks
  // made the number jump around: a flush advances writtenRef immediately, but
  // the snapshot carrying that count arrives later, and any click landing in
  // that gap was counted against a total the server hadn't reported yet. The
  // number would collapse and then snap back, twice a second.
  //
  // So the two sources are kept strictly apart: our count is purely local and
  // only ever goes up, everyone else's is purely from Firestore.
  useEffect(() => {
    if (!weekKey) return;
    const ref = collection(db, 'tieBreakers', weekKey, 'clicks');
    return onSnapshot(ref, (snap) => {
      const others = snap.docs.filter((d) => d.id !== uid).map((d) => d.data() as any);
      setRemote(battleTally(battle.options, others));

      // Recover our own side and count after a reload mid-battle. Safe to seed
      // myCount from the document because it is not in `remote`.
      const mine = snap.docs.find((d) => d.id === uid)?.data() as any;
      if (mine?.choice && !sideRef.current) {
        sideRef.current = mine.choice;
        setSide(mine.choice);
        writtenRef.current = mine.count || 0;
        setMyCount(mine.count || 0);
      }
    });
  }, [weekKey, uid, battle.options]);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    if (!sideRef.current || pendingRef.current <= 0) return;

    // Never exceed the per-write cap in firestore.rules — a rejected write
    // would drop the whole batch on the floor.
    const take = Math.min(pendingRef.current, MAX_CLICKS_PER_FLUSH);
    const next = writtenRef.current + take;

    flushingRef.current = true;
    try {
      await setDoc(doc(db, 'tieBreakers', weekKey, 'clicks', uid), {
        choice: sideRef.current,
        count: next,
        updatedAt: serverTimestamp(),
      });
      pendingRef.current -= take;
      writtenRef.current = next;
    } catch {
      // Keep the buffer and let the next tick retry. firestore.rules requires
      // 350ms between writes, and network jitter can land two flushes inside
      // that window — dropping the buffer here would silently eat those clicks.
      // writtenRef is deliberately not advanced, so the retry recomputes the
      // same absolute count from the same base.
    } finally {
      flushingRef.current = false;
    }
  }, [weekKey, uid]);

  useEffect(() => {
    if (!live) {
      void flush(); // one last write on the whistle
      return;
    }
    const id = setInterval(flush, FLUSH_MS);
    return () => clearInterval(id);
  }, [live, flush]);

  function click(option: string) {
    if (!live) return;
    // First click commits you. Also enforced in firestore.rules, so this is
    // convenience rather than the actual guarantee.
    if (!sideRef.current) {
      sideRef.current = option;
      setSide(option);
    }
    if (sideRef.current !== option) return;

    pendingRef.current += 1;
    setMyCount((n) => n + 1);
  }

  // Others from the server, ourselves from local state. `myCount` only ever
  // increases, so our side of the scoreboard can never tick backwards.
  //
  // Keyed on `side` (state) rather than sideRef — a ref mutation would not
  // recompute this, which is half of how the old flicker got in.
  const display = useMemo(() => {
    const out = { ...remote };
    if (side) out[side] = (out[side] || 0) + myCount;
    return out;
  }, [remote, myCount, side]);

  const total = Object.values(display).reduce((a, b) => a + b, 0);
  const seconds = (msLeft / 1000).toFixed(1);

  return (
    <section className="mt-6 border-t border-border pt-5">
      <div className="flex items-baseline justify-between">
        <p className="ticket-meta text-[0.625rem] text-stamp-600">
          {live ? 'CLICK BATTLE — GO' : 'CLICK BATTLE — TIME'}
        </p>
        <p
          className={cn(
            'ticket-meta text-xs tabular-nums',
            live && msLeft < 5000 ? 'text-stamp-600' : 'text-ink-muted'
          )}
          aria-hidden="true"
        >
          {seconds}s
        </p>
      </div>

      <p className="mt-2 text-sm text-ink-muted">
        {side
          ? 'You’re locked in. Keep going.'
          : 'Pick a side and mash. Your first click commits you.'}
      </p>

      <div className="mt-4 flex flex-col gap-2.5">
        {battle.options.map((option) => {
          const mine = side === option;
          const locked = !!side && !mine;
          const count = display[option] || 0;
          const share = total > 0 ? (count / total) * 100 : 0;

          return (
            <button
              key={option}
              type="button"
              onClick={() => click(option)}
              disabled={!live || locked}
              aria-label={`${option}: ${count} clicks`}
              className={cn(
                'relative overflow-hidden border-2 px-4 py-4 text-left transition-colors',
                'disabled:cursor-not-allowed',
                mine
                  ? 'border-stamp-600 bg-stamp-50 active:bg-stamp-100'
                  : 'border-ink bg-surface hover:bg-surface-muted',
                locked && 'opacity-45'
              )}
            >
              {/* Fill behind the label — the one place a bar earns its keep,
                  because this is a live tug of war, not a settled result. */}
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 bg-stamp-100 transition-[width] duration-200"
                style={{ width: `${share}%` }}
              />
              <span className="relative flex items-baseline justify-between gap-3">
                <span className={cn('text-base', mine ? 'font-semibold text-stamp-700' : 'text-ink')}>
                  {option}
                </span>
                <span data-numeric className="ticket-meta shrink-0 text-sm text-ink">
                  {count}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {!live && (
        <p className="mt-4 text-center text-sm text-ink-muted" aria-live="polite">
          Time. Counting the last clicks…
        </p>
      )}
    </section>
  );
}
