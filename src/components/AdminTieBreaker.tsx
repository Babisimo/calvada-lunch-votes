import { useEffect, useState } from 'react';
import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import toast from 'react-hot-toast';
import { Coins } from 'lucide-react';
import { subscribeWeeklyOptions } from './utils/subscribeWeeklyOptions';
import { normalizeChoices } from './utils/normalizeChoices';
import { normalizeKey } from './utils/normalizeKey';
import { topTie, flipPick } from './utils/tie';
import { readVotingWindow } from './utils/votingWindow';
import { btn, btnSize, cn, panel } from './ui/styles';

/**
 * The coin flip that settles a tied week.
 *
 * Ties are deliberately NOT resolved automatically. Leaderboard.tsx detects one
 * and writes nothing, because `firestore.rules` allows exactly one winner write
 * per voting window — spending it on an arbitrary pick would make the tie
 * permanent and uncorrectable. This is where that single write gets spent, once,
 * by a human.
 *
 * No rules change was needed: the winner-write path is gated on `isCalvada()`,
 * which an @calvada.com admin already satisfies. The write still has to name a
 * choice that was on the ballot, carry the server clock, and be the first
 * decision for this window — all enforced server-side, not here.
 *
 * Renders nothing at all unless there is a live tie awaiting a decision.
 */
export default function AdminTieBreaker({ weekKey }: { weekKey: string }) {
  const [choices, setChoices] = useState<string[]>([]);
  const [winner, setWinner] = useState<any | null>(null);
  const [endMs, setEndMs] = useState(0);
  const [needsResave, setNeedsResave] = useState(false);
  const [results, setResults] = useState<{ choice: string; count: number }[]>([]);
  const [flipping, setFlipping] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Coarse tick: this panel only cares about crossing the closing time.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!weekKey) {
      setChoices([]);
      setWinner(null);
      return;
    }
    return subscribeWeeklyOptions(weekKey, (data: any) => {
      setChoices(normalizeChoices(data?.choices));
      setWinner(data?.winner ?? null);
    });
  }, [weekKey]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'votingConfig'), (snap) => {
      // Read endMs the way firestore.rules does. Parsing the ISO string here
      // instead is what let this panel offer a flip the server would always
      // deny. See utils/votingWindow.ts.
      const win = readVotingWindow(snap.exists() ? snap.data() : null);
      setEndMs(win.endMs);
      setNeedsResave(win.needsResave);
    });
    return () => unsub();
  }, []);

  // Tally, mirroring Leaderboard: top-level /votes with a collectionGroup
  // fallback, and only choices still on the ballot are counted.
  useEffect(() => {
    if (!weekKey) {
      setResults([]);
      return;
    }

    function build(rows: any[]) {
      const labelByKey = new Map(choices.map((c) => [normalizeKey(c), c]));
      const tally: Record<string, number> = {};
      rows.forEach((data) => {
        const k = normalizeKey(String(data?.choice ?? ''));
        if (!k || !labelByKey.has(k)) return;
        tally[k] = (tally[k] || 0) + 1;
      });
      setResults(
        choices
          .map((c) => ({ choice: c, count: tally[normalizeKey(c)] || 0 }))
          .sort((a, b) => b.count - a.count)
      );
    }

    const qTop = query(collection(db, 'votes'), where('week', '==', weekKey));
    let unsub = onSnapshot(
      qTop,
      (snap) => build(snap.docs.map((d) => d.data())),
      () => {
        const qCG = query(collectionGroup(db, 'votes'), where('week', '==', weekKey));
        unsub = onSnapshot(qCG, (snap) => build(snap.docs.map((d) => d.data())));
      }
    );
    return () => unsub && unsub();
  }, [weekKey, choices]);

  const tied = topTie(results);
  const windowClosed = !!endMs && now >= endMs;
  const settledForThisWindow = winner?.decidedForEndMs === endMs;

  if (!weekKey || !windowClosed || tied.length < 2 || settledForThisWindow) return null;

  async function flip() {
    if (flipping) return;
    setFlipping(true);

    // The coin is thrown here, once. Everything downstream only replays it.
    const picked = flipPick(tied);

    try {
      // Re-tally from a fresh read rather than trusting the subscription: a late
      // vote could have landed between the last snapshot and this click, which
      // would mean flipping over a tie that no longer exists.
      const snap = await getDocs(query(collection(db, 'votes'), where('week', '==', weekKey)));
      const labelByKey = new Map(choices.map((c) => [normalizeKey(c), c]));
      const tally: Record<string, number> = {};
      snap.forEach((d) => {
        const k = normalizeKey(String(d.data().choice ?? ''));
        if (!k || !labelByKey.has(k)) return;
        tally[k] = (tally[k] || 0) + 1;
      });

      const fresh = choices
        .map((c) => ({ choice: c, count: tally[normalizeKey(c)] || 0 }))
        .sort((a, b) => b.count - a.count);
      const freshTie = topTie(fresh);

      if (freshTie.length < 2) {
        toast.error('No longer tied — a vote landed. Reload to see the result.');
        return;
      }
      if (!freshTie.includes(picked)) {
        toast.error('The tie changed while flipping. Try again.');
        return;
      }

      const total = fresh.reduce((sum, r) => sum + r.count, 0);
      const weeklyRef = doc(db, 'weeklyOptions', weekKey);

      await runTransaction(db, async (tx) => {
        const current = await tx.get(weeklyRef);
        if (!current.exists()) throw new Error('This week has no options document.');
        // Someone else may have settled it between the read and here.
        if ((current.data() as any)?.winner?.decidedForEndMs === endMs) return;

        tx.set(
          weeklyRef,
          {
            winner: {
              name: picked,
              tally: Object.fromEntries(fresh.map((r) => [r.choice, r.count])),
              total,
              decidedAt: serverTimestamp(),
              decidedForEndMs: endMs,
              source: 'admin-flip',
              // These two are what tell every visitor's Leaderboard to replay
              // the flip instead of going straight to the stamp.
              viaFlip: true,
              tiedBetween: freshTie,
            },
          },
          { merge: true }
        );
      });

      toast.success(`${picked} wins the flip`);
    } catch (err: any) {
      console.error('[AdminTieBreaker] flip failed:', err);
      // "Try again" was actively misleading for the failure that actually
      // happened: a rules denial repeats forever. Name the likely cause.
      if (err?.code === 'permission-denied') {
        toast.error('The rules rejected it — the voting window needs re-saving in /admin.');
      } else {
        toast.error("Couldn't record the flip. Try again.");
      }
    } finally {
      setFlipping(false);
    }
  }

  return (
    <section className={cn(panel, 'paper-tear relative p-5 pt-7 sm:p-6 sm:pt-8')}>
      <div className="ticket-meta text-[0.625rem] text-stamp-600">TIE — NEEDS A DECISION</div>

      <h2 className="ticket-title mt-3 text-xl">
        {tied.length} way tie
      </h2>

      <p className="mt-2 text-sm text-ink-muted">
        Nothing is decided automatically — the week stays open until you flip. Everyone who opens
        the site afterwards watches the coin land on the result.
      </p>

      <ul className="mt-4 flex flex-col">
        {tied.map((name) => (
          <li key={name} className="flex items-baseline gap-2.5 py-1.5">
            <span className="min-w-0 shrink truncate font-semibold text-ink">{name}</span>
            <span aria-hidden="true" className="leader" />
            <span data-numeric className="ticket-meta shrink-0 text-xs text-ink">
              {results.find((r) => r.choice === name)?.count ?? 0}
            </span>
          </li>
        ))}
      </ul>

      {needsResave ? (
        // Don't offer an action the server is guaranteed to refuse. The saved
        // window has no numeric endMs, so firestore.rules cannot tell that
        // voting ever closed and denies every winner write.
        <div className="mt-6 border-t border-border pt-5">
          <p className="ticket-meta text-[0.625rem] text-danger-600">TIMER NEEDS RE-SAVING</p>
          <p className="mt-2 text-sm text-ink-muted">
            This week&apos;s voting window was saved in an older format with no numeric end time,
            and the security rules can&apos;t read it — so nothing can settle the week yet. Open the
            voting window panel below, re-enter the same times and press{' '}
            <span className="font-semibold text-ink">Save window</span>. The coin flip appears once
            that&apos;s done.
          </p>
        </div>
      ) : (
        <>
          <button
            onClick={flip}
            disabled={flipping}
            className={cn(btn.primary, btnSize.lg, 'mt-6')}
          >
            <Coins size={16} strokeWidth={2.25} aria-hidden="true" />
            {flipping ? 'Flipping…' : 'Flip the coin'}
          </button>

          <p className="mt-2.5 text-center text-xs text-ink-subtle">
            This can only be done once for this voting window.
          </p>
        </>
      )}
    </section>
  );
}
