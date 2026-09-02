// src/components/Leaderboard.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../firebaseConfig';
import {
  collection, collectionGroup, doc, onSnapshot, query, where,
  getDocs, runTransaction, serverTimestamp
} from 'firebase/firestore';
import { useWeekKey } from './utils/useWeekKey';
import { normalizeChoices } from './utils/normalizeChoices';
import { normalizeKey } from './utils/normalizeKey';
import { subscribeWeeklyOptions } from './utils/subscribeWeeklyOptions';
import { Clock, Lock, RotateCcw, TimerReset } from 'lucide-react';
import confetti from 'canvas-confetti';
import { btn, cn, panel, ticketRule } from './ui/styles';
import { topTie } from './utils/tie';
import { readVotingWindow } from './utils/votingWindow';
import CoinFlip from './ui/CoinFlip';

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

/**
 * The coin flip plays once per person per week, then the result just sits there.
 * A 2.2-second animation on every page load for the rest of the week would wear
 * out fast. Guarded because localStorage throws outright in some contexts —
 * worst case someone sees the flip twice, which is harmless.
 */
const FLIP_SEEN_KEY = 'calvada-lunch-flip-seen';

function hasSeenFlip(weekKey: string): boolean {
  try {
    return localStorage.getItem(FLIP_SEEN_KEY) === weekKey;
  } catch {
    return false;
  }
}

function markFlipSeen(weekKey: string): void {
  try {
    localStorage.setItem(FLIP_SEEN_KEY, weekKey);
  } catch {
    // Session-only. They'll see it again next load; not worth handling.
  }
}

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
  const warnedResaveRef = useRef(false);

  const [windowNeedsResave, setWindowNeedsResave] = useState(false);

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
      const win = readVotingWindow(snap.data());
      setVoteStartMs(win.startMs || null);
      setEndTimeMs(win.endMs || null);
      setWindowNeedsResave(win.needsResave);
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

    // Without numeric startMs/endMs the rules cannot tell voting ever closed and
    // deny every winner write. Attempting anyway retried a doomed transaction
    // once a second, quietly burning reads. Say it once and stop.
    if (windowNeedsResave) {
      if (!warnedResaveRef.current) {
        warnedResaveRef.current = true;
        console.warn(
          '[Leaderboard] No winner can be recorded: config/votingConfig has no numeric endMs. ' +
            'Re-save the voting window in /admin.'
        );
      }
      return;
    }

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

        const max = Math.max(...Object.values(tallyByKey));
        const topKeys = Object.keys(tallyByKey).filter((k) => tallyByKey[k] === max);

        // A TIE IS NOT RESOLVED HERE. It used to fall to whichever option was
        // drawn first on the ballot, which is both invisible and biased — and
        // worse, that write spends the single winner write firestore.rules
        // allows per voting window, making the arbitrary pick permanent.
        // Leaving it unwritten is what surfaces the coin flip in /admin.
        if (topKeys.length > 1) return;

        const winnerKey = topKeys[0];
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
  }, [weekKey, endTimeMs, now, totalVotes, weeklyChoices, weeklyWinner, weeklyUpdatedAtMs, windowNeedsResave]);

  const decidedAtMs = toMillis(weeklyWinner?.decidedAt);
  const windowClosed = !!endTimeMs && now >= endTimeMs;
  const showWinnerBanner =
    !!weeklyWinner?.name &&
    windowClosed &&
    totalVotes > 0 &&
    (weeklyUpdatedAtMs === 0 || decidedAtMs >= weeklyUpdatedAtMs);

  // A tie is never resolved automatically — see the decide effect above. Until
  // an admin flips, the week genuinely has no winner, which is a different
  // state from "the result is a second away".
  const tiedTop = useMemo(() => topTie(results), [results]);
  const awaitingFlip = windowClosed && totalVotes > 0 && !showWinnerBanner && tiedTop.length > 1;

  // Closed with votes in, but the tally above hasn't landed yet. Usually a
  // second; longer if the voting window has no numeric endMs saved.
  const awaitingResult =
    windowClosed && totalVotes > 0 && !showWinnerBanner && tiedTop.length <= 1;

  // Replay of a flip the admin already made. `flipStage` starts 'unknown' so we
  // decide once, after the winner has actually loaded, whether this visitor
  // gets the animation or goes straight to the settled result.
  const [flipStage, setFlipStage] = useState<'unknown' | 'play' | 'done'>('unknown');

  useEffect(() => {
    if (flipStage !== 'unknown') return;
    if (!showWinnerBanner) return;

    if (!weeklyWinner?.viaFlip) {
      setFlipStage('done');
      return;
    }
    // Seen it, or asked not to be animated at — skip to the result.
    if (prefersReducedMotion() || hasSeenFlip(weekKey)) {
      setFlipStage('done');
      return;
    }
    setFlipStage('play');
  }, [flipStage, showWinnerBanner, weeklyWinner, weekKey]);

  const playingFlip = flipStage === 'play';

  // Marking it seen on replay too, so a deliberate rewatch doesn't queue up an
  // unwanted automatic one on the next visit.
  const finishFlip = useCallback(() => {
    markFlipSeen(weekKey);
    setFlipStage('done');
  }, [weekKey]);

  // Evidence copy for a flip-decided week. `tiedBetween` and `tally` are both on
  // the winner document, so this survives reloads and works for anyone who
  // never saw the animation.
  const flipTied: string[] = weeklyWinner?.tiedBetween ?? [];
  const flipLosers = flipTied.filter((name) => name !== weeklyWinner?.name);
  const flipCount = weeklyWinner?.tally?.[flipTied[0]] ?? 0;
  const flipLabel =
    flipTied.length === 2
      ? `TIE ${flipCount}–${flipCount} · SETTLED BY COIN FLIP`
      : `${flipTied.length}-WAY TIE AT ${flipCount} · SETTLED BY COIN FLIP`;

  // Gated on flipStage rather than showWinnerBanner: on a flip-decided week the
  // winner is known the moment the page loads, so celebrating on that alone
  // would fire the confetti while the coin is still in the air. 'done' is
  // reached immediately for an ordinary week and after the coin lands for a
  // flipped one, which is exactly when the stamp appears.
  useEffect(() => {
    if (!showWinnerBanner || flipStage !== 'done' || hasCelebratedRef.current) return;
    hasCelebratedRef.current = true;
    if (prefersReducedMotion()) return;
    confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 } });
    setTimeout(() => confetti({ particleCount: 110, spread: 100, origin: { y: 0.75 } }), 350);
  }, [showWinnerBanner, flipStage]);

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
    // No overflow-hidden here: the winner stamp is rotated and its corners must
    // be allowed past the text column. Radius is 0, so nothing needs clipping.
    <section className={cn(panel, 'paper-tear relative pt-2')}>
      <header className="px-5 pt-4 sm:px-6">
        <div
          className={cn(
            ticketRule,
            'ticket-meta flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-2 text-[0.625rem] text-ink-muted'
          )}
        >
          <span>{windowClosed ? 'CLOSED' : 'OPEN'}</span>

          {/* Single source of countdown truth — Voting.tsx no longer renders
              one. Only the icon pulses in the last hour; pulsing the digits
              would fight the per-second updates and make them hard to read. */}
          <span
            className={cn(
              'inline-flex items-center gap-1.5',
              timer.tone === 'live' ? 'text-stamp-600' : 'text-ink-subtle'
            )}
          >
            <span aria-hidden="true" className={cn(isFinalHour && 'animate-urgent')}>
              {timer.icon}
            </span>
            <span>{timer.label.toUpperCase()}</span>
            {timer.value && <time data-numeric>{timer.value}</time>}
          </span>
        </div>

        <h2 className="ticket-title mt-4 text-2xl">
          {windowClosed ? (
            <>
              Final
              <br />
              count
            </>
          ) : (
            <>
              Running
              <br />
              count
            </>
          )}
        </h2>
      </header>

      {awaitingResult && (
        <div className="mt-4 flex items-center gap-3 border-y border-border bg-surface-muted px-5 py-3.5 sm:px-6">
          <span aria-hidden="true" className="text-lg">⏳</span>
          <p className="text-sm text-ink-muted">Voting is closed. Counting the final result…</p>
        </div>
      )}

      {awaitingFlip && (
        <div className="mt-4 border-y border-stamp-200 bg-stamp-50 px-5 py-3.5 sm:px-6">
          <p className="ticket-meta text-[0.625rem] text-stamp-600">
            TIE — {tiedTop.length} WAY
          </p>
          <p className="mt-1.5 text-sm text-ink-muted">
            {/* Names the deadlock rather than saying "a tie" — people want to
                know which two, and it explains why nothing has been decided. */}
            {tiedTop.join(' and ')} are level. An admin flips a coin to settle it.
          </p>
        </div>
      )}

      <div className="px-5 pb-6 pt-5 sm:px-6">
        {weeklyChoices.length === 0 && results.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-subtle">
            <span aria-hidden="true" className="mr-1.5">🗳️</span>
            No options set for this week yet.
          </p>
        ) : (
          <>
            {/* The tally is set as receipt lines, not bars. A dot leader gives
                the exact count instead of an approximate length — which also
                means proportion is no longer readable at a glance, so the
                percentage stays on the line and a TOTAL closes the ticket. */}
            <ol className="flex flex-col">
              {results.map((r, idx) => {
                const percentage = totalVotes > 0 ? (r.count / totalVotes) * 100 : 0;
                const isWinner = showWinnerBanner && weeklyWinner?.name === r.choice;

                return (
                  <li
                    key={`${r.choice}-${idx}`}
                    className="animate-rise flex items-baseline gap-2.5 py-1.5"
                    style={{ animationDelay: `${idx * 70}ms` }}
                  >
                    {/* Rank is real information — the list is a standing, and an
                        order pad numbers its lines anyway. The <ol> carries the
                        order for screen readers, so this marker is decorative. */}
                    <span
                      data-numeric
                      aria-hidden="true"
                      className="ticket-meta w-4 shrink-0 text-[0.625rem] text-ink-subtle"
                    >
                      {idx + 1}
                    </span>

                    <span
                      className={cn(
                        'min-w-0 shrink truncate',
                        isWinner ? 'font-semibold text-stamp-700' : 'text-ink'
                      )}
                    >
                      {r.choice}
                    </span>

                    <span aria-hidden="true" className="leader" />

                    <span data-numeric className="ticket-meta shrink-0 text-xs">
                      <span className={cn(isWinner ? 'text-stamp-700' : 'text-ink')}>{r.count}</span>
                      {/* Percent alone hides sample size: 33% of 3 ≠ 33% of 60. */}
                      <span className="text-ink-subtle"> · {Math.round(percentage)}%</span>
                    </span>
                  </li>
                );
              })}
            </ol>

            <div
              className={cn(
                'ticket-meta mt-3 flex items-baseline justify-between border-t border-ink pt-2.5 text-[0.625rem] text-ink-muted'
              )}
            >
              <span>TOTAL</span>
              <span data-numeric>
                {totalVotes} {totalVotes === 1 ? 'VOTE' : 'VOTES'}
              </span>
            </div>

            {/* A flip-decided week performs the coin first, then stamps. The
                coin only replays a result the admin already wrote — see
                ui/CoinFlip.tsx — so the stamp below is the same either way. */}
            {playingFlip && (
              <CoinFlip
                tiedBetween={weeklyWinner?.tiedBetween ?? []}
                winner={weeklyWinner?.name ?? ''}
                onDone={finishFlip}
              />
            )}

            {/* The permanent record that a CHOICE was made.
                The animation is a one-off; this is what anyone arriving later —
                or reloading — sees instead of a winner that appeared from
                nowhere. It names both options and how the deadlock broke, and
                the flip stays rewatchable rather than being a moment you miss. */}
            {showWinnerBanner && !playingFlip && weeklyWinner?.viaFlip && (
              <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t border-border pt-4">
                <div className="min-w-0">
                  <p className="ticket-meta text-[0.625rem] text-stamp-600">{flipLabel}</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {weeklyWinner.name}
                    {flipLosers.length > 0 && <> over {flipLosers.join(', ')}</>}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFlipStage('play')}
                  className={cn(btn.quiet, 'shrink-0 px-2 py-1')}
                >
                  <RotateCcw size={14} strokeWidth={2.25} aria-hidden="true" />
                  Watch the flip
                </button>
              </div>
            )}

            {showWinnerBanner && !playingFlip && (
              // The one orchestrated moment in the app, once a week. Rotated in
              // place rather than absolutely positioned — an overlay would sit
              // on top of the tally at narrow widths. Not color-only: the word
              // ORDERED and the dish name both carry the meaning.
              <div className="mt-6 flex justify-end pr-3">
                <p
                  className="animate-stamp ticket-control border-[3px] border-double border-stamp-600 px-3 pb-1.5 pt-2 text-center text-stamp-600 opacity-90"
                  style={{ transform: 'rotate(-11deg)' }}
                >
                  <span className="block text-lg leading-none">Ordered</span>
                  <span className="mt-1 block text-[0.5rem] tracking-[0.16em]">
                    {weeklyWinner?.name}
                  </span>
                </p>
              </div>
            )}

            {showWinnerBanner && !playingFlip && <p className="sr-only">{bannerText}</p>}
          </>
        )}
      </div>
    </section>
  );
}
