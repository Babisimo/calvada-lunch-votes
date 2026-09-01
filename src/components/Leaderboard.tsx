// src/components/Leaderboard.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../firebaseConfig';
import {
  collection, collectionGroup, doc, onSnapshot, query, where,
  getDocs, runTransaction, serverTimestamp
} from 'firebase/firestore';
import { useWeekKey } from './utils/useWeekKey';
import { normalizeChoices } from './utils/normalizeChoices';
import { normalizeKey } from './utils/normalizeKey';
import { subscribeWeeklyOptions } from './utils/subscribeWeeklyOptions';
import { Clock, Crown, Lock, TimerReset } from 'lucide-react';
import confetti from 'canvas-confetti';
import { cn, panel } from './ui/styles';

function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'object' && 'seconds' in v) return v.seconds * 1000;
  if (typeof v === 'string') { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; }
  if (typeof v === 'number') return v;
  return 0;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Voting closed';
  const totalSeconds = Math.floor(ms / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  return `${h}h ${m}m ${s}s`;
}

/** Stable hash so the winner blurb is the same for every viewer, every render. */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Podium markers. Only shown once a choice actually has votes. */
const MEDALS = ['🥇', '🥈', '🥉'];

const ONE_HOUR_MS = 60 * 60 * 1000;

export default function Leaderboard() {
  const weekKey = useWeekKey();

  const [weeklyChoices, setWeeklyChoices] = useState<string[]>([]);
  const [weeklyUpdatedAtMs, setWeeklyUpdatedAtMs] = useState<number>(0);
  const [weeklyWinner, setWeeklyWinner] = useState<any | null>(null);

  const [results, setResults] = useState<{ choice: string; count: number }[]>([]);
  const [totalVotes, setTotalVotes] = useState(0);
  const [voteStartMs, setVoteStartMs] = useState<number | null>(null);
  const [endTimeMs, setEndTimeMs] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const hasCelebratedRef = useRef(false);
  const decidingRef = useRef(false);

  // Bars start at zero and grow into place on first paint.
  const [barsReady, setBarsReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setBarsReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // weeklyOptions (resilient direct listener)
  useEffect(() => {
    if (!weekKey) { setWeeklyChoices([]); setWeeklyWinner(null); setWeeklyUpdatedAtMs(0); return; }
    return subscribeWeeklyOptions(weekKey, (data) => {
      if (!data) { setWeeklyChoices([]); setWeeklyWinner(null); setWeeklyUpdatedAtMs(0); return; }
      setWeeklyChoices(normalizeChoices(data.choices));
      setWeeklyWinner(data.winner ?? null);
      setWeeklyUpdatedAtMs(toMillis(data.updatedAt));
    });
  }, [weekKey]);

  // Votes — prefer TOP-LEVEL /votes; fallback to collectionGroup
  useEffect(() => {
    if (!weekKey) { setResults([]); setTotalVotes(0); return; }

    const qTop = query(collection(db, 'votes'), where('week', '==', weekKey));
    let unsubscribe = onSnapshot(qTop, (snap) => {
      buildTallyFromRows(snap.docs.map(d => d.data()));
    }, () => {
      const qCG = query(collectionGroup(db, 'votes'), where('week', '==', weekKey));
      unsubscribe = onSnapshot(qCG, (snapCG) => {
        buildTallyFromRows(snapCG.docs.map(d => d.data()));
      });
    });

    return () => unsubscribe && unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey, weeklyChoices]);

  function buildTallyFromRows(rows: any[]) {
    const tally: Record<string, number> = {};
    const voteKeys = new Set<string>();
    rows.forEach((data: any) => {
      const raw = String(data?.choice ?? '');
      const k = normalizeKey(raw);
      if (!k) return;
      tally[k] = (tally[k] || 0) + 1;
      voteKeys.add(k);
    });

    const labelByKey = new Map<string, string>();
    for (const c of weeklyChoices) labelByKey.set(normalizeKey(c), c);

    const baseKeys = weeklyChoices.length
      ? weeklyChoices.map(c => normalizeKey(c))
      : Array.from(voteKeys);

    const out = baseKeys.map(k => ({
      choice: labelByKey.get(k) ?? k,
      count: tally[k] || 0,
    })).sort((a, b) => b.count - a.count);

    setResults(out);
    setTotalVotes(rows.length);
  }

  // Voting window (start + end)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'votingConfig'), (snap) => {
      if (!snap.exists()) { setVoteStartMs(null); setEndTimeMs(null); return; }
      const data = snap.data();
      const startMs = toMillis(data?.startTime ?? data?.start);
      const endMs = toMillis(data?.endTime ?? data?.end);
      setVoteStartMs(startMs || null);
      setEndTimeMs(endMs || null);
    });
    return () => unsub();
  }, []);

  // Decide + persist the winner once the window closes.
  //
  // This runs in whichever browser is open first after closing time. That means
  // the result only lands when someone visits — the trade-off for not requiring
  // the Blaze plan. functions/index.js does the same job on a schedule if you
  // ever turn it on; both write the identical shape, and `decidedForEndMs`
  // keeps them from fighting.
  //
  // Keying on decidedForEndMs (rather than the old decidedAt-vs-updatedAt
  // comparison) is what makes extending the timer re-open the decision — it
  // replaces the stale-winner-clearing transaction that used to live in
  // VotingTimerAdmin.
  useEffect(() => {
    if (!weekKey || !endTimeMs || now < endTimeMs) return;
    if (totalVotes <= 0 || weeklyChoices.length === 0) return;
    if (decidingRef.current) return;

    const settledForThisWindow = weeklyWinner?.decidedForEndMs === endTimeMs;
    const staleAgainstBallot =
      !!weeklyWinner?.name && toMillis(weeklyWinner.decidedAt) < (weeklyUpdatedAtMs || 0);
    if (settledForThisWindow && !staleAgainstBallot) return;

    decidingRef.current = true;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'votes'), where('week', '==', weekKey)));

        const validKeys = new Set(weeklyChoices.map((c) => normalizeKey(c)));
        const labelByKey = new Map(weeklyChoices.map((c) => [normalizeKey(c), c]));
        const tallyByKey: Record<string, number> = {};

        snap.forEach((d) => {
          const k = normalizeKey(String(d.data().choice ?? ''));
          if (!k || !validKeys.has(k)) return;
          tallyByKey[k] = (tallyByKey[k] || 0) + 1;
        });

        const total = Object.values(tallyByKey).reduce((a, b) => a + b, 0);
        if (total <= 0) return;

        // Ties break by ballot order, so a re-run always agrees with itself.
        const max = Math.max(...Object.values(tallyByKey));
        const winnerKey = Object.keys(tallyByKey)
          .filter((k) => tallyByKey[k] === max)
          .sort(
            (a, b) =>
              weeklyChoices.findIndex((c) => normalizeKey(c) === a) -
              weeklyChoices.findIndex((c) => normalizeKey(c) === b)
          )[0];
        const winnerName = labelByKey.get(winnerKey) ?? winnerKey;

        const weeklyRef = doc(db, 'weeklyOptions', weekKey);
        await runTransaction(db, async (tx) => {
          const fresh = await tx.get(weeklyRef);
          if (!fresh.exists()) return;
          const data = fresh.data() as any;
          // Someone else's tab may have won the race between our read and here.
          if (data?.winner?.decidedForEndMs === endTimeMs) return;

          tx.set(
            weeklyRef,
            {
              winner: {
                name: winnerName,
                tally: Object.fromEntries(
                  Object.entries(tallyByKey).map(([k, v]) => [labelByKey.get(k) ?? k, v])
                ),
                total,
                decidedAt: serverTimestamp(),
                decidedForEndMs: endTimeMs,
                source: 'client',
              },
            },
            { merge: true }
          );
        });
      } catch (err) {
        // A losing race resolves as permission-denied; the winner still exists.
        console.warn('[Leaderboard] winner decision skipped:', err);
      } finally {
        decidingRef.current = false;
      }
    })();
  }, [weekKey, endTimeMs, now, totalVotes, weeklyChoices, weeklyWinner, weeklyUpdatedAtMs]);

  const decidedAtMs = toMillis(weeklyWinner?.decidedAt);
  const windowClosed = !!endTimeMs && now >= endTimeMs;
  const showWinnerBanner =
    !!weeklyWinner?.name &&
    windowClosed &&
    totalVotes > 0 &&
    (weeklyUpdatedAtMs === 0 || decidedAtMs >= weeklyUpdatedAtMs);

  // Closed with votes in, but the tally above hasn't landed yet. Usually a
  // second; longer if the voting window has no numeric endMs saved.
  const awaitingResult = windowClosed && totalVotes > 0 && !showWinnerBanner;

  useEffect(() => {
    if (!showWinnerBanner || hasCelebratedRef.current) return;
    hasCelebratedRef.current = true;
    if (prefersReducedMotion()) return;
    confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 } });
    setTimeout(() => confetti({ particleCount: 110, spread: 100, origin: { y: 0.75 } }), 350);
  }, [showWinnerBanner]);

  // Same week + same winner => same line for everyone. Math.random() re-rolled
  // on every remount and showed different copy to different people.
  const bannerText = useMemo(() => {
    if (!weeklyWinner?.name) return '';
    const msgs = [
      `We're eating ${weeklyWinner.name} this week 🎉`,
      `${weeklyWinner.name} takes it 🏆`,
      `The team picked ${weeklyWinner.name} 🙌`,
      `${weeklyWinner.name} wins the week 😋`,
    ];
    return msgs[hashString(`${weekKey}:${weeklyWinner.name}`) % msgs.length];
  }, [weeklyWinner?.name, weekKey]);

  // Derived timer state
  const votingOpen = !!voteStartMs && !!endTimeMs && now >= voteStartMs && now < endTimeMs;
  const votingNotStarted = !!voteStartMs && now < voteStartMs;
  const msUntilStart = voteStartMs ? voteStartMs - now : 0;
  const msUntilEnd = endTimeMs ? endTimeMs - now : 0;
  const isFinalHour = votingOpen && msUntilEnd > 0 && msUntilEnd <= ONE_HOUR_MS;

  const timer = (() => {
    if (votingOpen) {
      return {
        icon: <Clock size={15} strokeWidth={2.25} />,
        label: 'Closes in',
        value: formatCountdown(msUntilEnd),
        tone: 'live' as const,
      };
    }
    if (votingNotStarted) {
      return {
        icon: <TimerReset size={15} strokeWidth={2.25} />,
        label: 'Opens in',
        value: formatCountdown(msUntilStart),
        tone: 'muted' as const,
      };
    }
    if (endTimeMs && now >= endTimeMs) {
      return {
        icon: <Lock size={15} strokeWidth={2.25} />,
        label: 'Voting closed',
        value: null,
        tone: 'muted' as const,
      };
    }
    return {
      icon: <TimerReset size={15} strokeWidth={2.25} />,
      label: 'Not scheduled yet',
      value: null,
      tone: 'muted' as const,
    };
  })();

  return (
    <section className={cn(panel, 'overflow-hidden')}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">Results</h2>
          {/* The week key is an internal identifier — it stays in the admin
              screens, where rolling it over is someone's job. Voters just need
              the count. */}
          <p className="mt-0.5 text-sm text-ink-subtle">
            <span data-numeric>{totalVotes}</span> {totalVotes === 1 ? 'vote' : 'votes'}
          </p>
        </div>

        {/* Single source of countdown truth — Voting.tsx no longer renders one. */}
        <div
          className={cn(
            'inline-flex items-center gap-2 rounded-field px-3 py-1.5 text-sm font-semibold transition-colors',
            timer.tone === 'live'
              ? 'bg-brand-50 text-brand-800'
              : 'bg-surface-muted text-ink-subtle'
          )}
        >
          {/* Only the icon pulses in the last hour — pulsing the digits would
              fight the per-second updates and make them hard to read. */}
          <span aria-hidden="true" className={cn(isFinalHour && 'animate-urgent')}>
            {timer.icon}
          </span>
          <span className="font-normal">{timer.label}</span>
          {timer.value && (
            <time data-numeric className="font-semibold">
              {timer.value}
            </time>
          )}
        </div>
      </header>

      {showWinnerBanner && (
        <div className="animate-banner-in flex items-center gap-3 border-b border-brand-200 bg-brand-50 px-5 py-4 sm:px-6">
          <span
            aria-hidden="true"
            className="animate-bob flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-200 text-brand-900"
          >
            <Crown size={18} strokeWidth={2.25} />
          </span>
          <p className="font-display text-lg font-bold tracking-tight text-brand-900">
            {bannerText}
          </p>
        </div>
      )}

      {awaitingResult && (
        <div className="flex items-center gap-3 border-b border-border bg-surface-muted px-5 py-3.5 sm:px-6">
          <span aria-hidden="true" className="text-lg">⏳</span>
          <p className="text-sm text-ink-muted">Voting is closed. Counting the final result…</p>
        </div>
      )}

      <div className="px-5 py-5 sm:px-6">
        {weeklyChoices.length === 0 && results.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-subtle">
            <span aria-hidden="true" className="mr-1.5">🗳️</span>
            No options set for this week yet.
          </p>
        ) : (
          <ol className="space-y-4">
            {results.map((r, idx) => {
              const percentage = totalVotes > 0 ? (r.count / totalVotes) * 100 : 0;
              const isWinner = showWinnerBanner && weeklyWinner?.name === r.choice;

              const medal = r.count > 0 ? MEDALS[idx] : undefined;

              return (
                <li
                  key={`${r.choice}-${idx}`}
                  className="animate-rise"
                  style={{ animationDelay: `${idx * 70}ms` }}
                >
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      {/* Rank is real information here — the list is a standing.
                          The <ol> carries the order for screen readers, so the
                          marker itself is decorative. */}
                      <span
                        data-numeric
                        aria-hidden="true"
                        className={cn(
                          'w-5 shrink-0 text-sm font-semibold text-ink-subtle',
                          medal && 'text-base'
                        )}
                      >
                        {medal ?? idx + 1}
                      </span>
                      <span
                        className={cn(
                          'truncate font-semibold',
                          isWinner ? 'text-brand-900' : 'text-ink'
                        )}
                      >
                        {r.choice}
                      </span>
                      {isWinner && (
                        // Not color-only: the crown + label carry the meaning too.
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-200 px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-brand-900">
                          <Crown size={11} strokeWidth={2.75} aria-hidden="true" />
                          Winner
                        </span>
                      )}
                    </span>
                    {/* Percent alone hides sample size: 33% of 3 ≠ 33% of 60. */}
                    <span data-numeric className="shrink-0 text-sm text-ink-muted">
                      <span className="font-semibold text-ink">{r.count}</span>
                      <span className="text-ink-subtle"> · {Math.round(percentage)}%</span>
                    </span>
                  </div>

                  <div
                    role="progressbar"
                    aria-valuenow={Math.round(percentage)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${r.choice}: ${r.count} of ${totalVotes} votes`}
                    className="h-2.5 w-full overflow-hidden rounded-full bg-surface-muted"
                  >
                    {/* Every bar is the Calvada green. Bar LENGTH already encodes
                        standing, so coloring by rank would be redundant — and the
                        old index-keyed rainbow made bars swap colors whenever the
                        ranking moved, which read as the data changing. */}
                    <div
                      className="h-full rounded-full bg-brand-500 transition-[width] duration-700 ease-out"
                      style={{ width: barsReady ? `${percentage}%` : '0%' }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
