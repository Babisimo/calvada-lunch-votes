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
import confetti from 'canvas-confetti';

const colors = ['bg-blue-500','bg-green-500','bg-purple-500','bg-yellow-500','bg-pink-500','bg-red-500'];

function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'object' && 'seconds' in v) return v.seconds * 1000;
  if (typeof v === 'string') { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; }
  if (typeof v === 'number') return v;
  return 0;
}

export default function Leaderboard() {
  const weekKey = useWeekKey();

  const [weeklyChoices, setWeeklyChoices] = useState<string[]>([]);
  const [weeklyUpdatedAtMs, setWeeklyUpdatedAtMs] = useState<number>(0);
  const [weeklyWinner, setWeeklyWinner] = useState<any | null>(null);

  const [results, setResults] = useState<{ choice: string; count: number }[]>([]);
  const [totalVotes, setTotalVotes] = useState(0);
  const [endTimeMs, setEndTimeMs] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const hasCelebratedRef = useRef(false);
  const decidingRef = useRef(false); // prevents duplicate client-side decides

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

  // Voting window end
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'votingConfig'), (snap) => {
      if (!snap.exists()) { setEndTimeMs(null); return; }
      const data = snap.data();
      const endMs = toMillis(data?.endTime ?? data?.end);
      setEndTimeMs(endMs || null);
    });
    return () => unsub();
  }, []);

  // Decide + persist winner ONCE after timer ends (only if there are votes)
  useEffect(() => {
    const timeOver = !!endTimeMs && now >= endTimeMs;
    const noWinnerOrStale =
      !weeklyWinner?.name || toMillis(weeklyWinner.decidedAt) < (weeklyUpdatedAtMs || 0);

    if (!weekKey || !timeOver || totalVotes <= 0 || !noWinnerOrStale || decidingRef.current) return;

    decidingRef.current = true;
    (async () => {
      try {
        // Read votes for this week (top-level)
        const qTop = query(collection(db, 'votes'), where('week', '==', weekKey));
        const snap = await getDocs(qTop);

        // Build tally against CURRENT weeklyChoices (normalized)
        const validSet = new Set(weeklyChoices.map(c => normalizeKey(c)));
        const tally: Record<string, number> = {};
        snap.forEach(d => {
          const k = normalizeKey(String(d.data().choice ?? ''));
          if (!k || !validSet.has(k)) return; // ignore votes for options not in this week's choices
          tally[k] = (tally[k] || 0) + 1;
        });

        const total = Object.values(tally).reduce((a, b) => a + b, 0);
        if (total <= 0) { decidingRef.current = false; return; } // no valid votes for current options

        // Determine winner label using weeklyChoices as source-of-truth for display names
        const labelByKey = new Map<string, string>();
        for (const c of weeklyChoices) labelByKey.set(normalizeKey(c), c);

        const max = Math.max(...Object.values(tally));
        const topKeys = Object.keys(tally).filter(k => tally[k] === max);
        // deterministic tie-breaker: pick first by weeklyChoices order
        const winnerKey = topKeys.sort((a, b) =>
          weeklyChoices.findIndex(c => normalizeKey(c) === a) -
          weeklyChoices.findIndex(c => normalizeKey(c) === b)
        )[0];
        const winnerName = labelByKey.get(winnerKey) ?? winnerKey;

        // Transaction: only set winner if still missing or stale
        const weeklyRef = doc(db, 'weeklyOptions', weekKey);
        await runTransaction(db, async (tx) => {
          const snapWeekly = await tx.get(weeklyRef);
          if (!snapWeekly.exists()) return;

          const data = snapWeekly.data() as any;
          const existing = data?.winner;
          const updatedAt = toMillis(data?.updatedAt);

          // If already decided AFTER the latest options update, skip
          if (existing?.name && toMillis(existing.decidedAt) >= updatedAt) return;

          const winnerPayload = {
            name: winnerName,
            tally: Object.fromEntries(
              Object.entries(tally).map(([k, v]) => [labelByKey.get(k) ?? k, v]) // store with pretty labels
            ),
            decidedAt: serverTimestamp(),
            source: 'auto',
          };
          tx.set(weeklyRef, { winner: winnerPayload }, { merge: true });
        });

        // Let the listener pick up the freshly written winner
      } finally {
        decidingRef.current = false;
      }
    })();
  }, [weekKey, endTimeMs, now, totalVotes, weeklyWinner, weeklyUpdatedAtMs, weeklyChoices]);

  const decidedAtMs = toMillis(weeklyWinner?.decidedAt);
  const showWinnerBanner =
    !!weeklyWinner?.name &&
    !!endTimeMs && now >= endTimeMs &&
    totalVotes > 0 &&
    (weeklyUpdatedAtMs === 0 || decidedAtMs >= weeklyUpdatedAtMs);

  useEffect(() => {
    if (showWinnerBanner && !hasCelebratedRef.current) {
      confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 } });
      setTimeout(() => confetti({ particleCount: 110, spread: 100, origin: { y: 0.75 } }), 350);
      hasCelebratedRef.current = true;
    }
  }, [showWinnerBanner]);

  const bannerText = useMemo(() => {
    if (!weeklyWinner?.name) return '';
    const msgs = [
      "We're eating ___ this week! 🎉",
      '___ won! 👑',
      'Cravings secured: ___ 😋',
      'The people have spoken: ___! 🗳️',
      'Lunch destiny: ___ 🚀',
    ];
    return msgs[Math.floor(Math.random()*msgs.length)].replace('___', weeklyWinner.name);
  }, [weeklyWinner?.name]);

  return (
    <div className="mb-10">
      <h2 className="text-2xl font-semibold mb-4 text-center">📊 Leaderboard</h2>

      {showWinnerBanner && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-center shadow-sm">
          <div className="text-lg font-semibold text-emerald-800">{bannerText}</div>
        </div>
      )}

      {weeklyChoices.length === 0 && results.length === 0 ? (
        <p className="text-gray-500 text-center">Weekly options not set.</p>
      ) : (
        <ul className="space-y-4">
          {results.map((r, idx) => {
            const percentage = totalVotes > 0 ? (r.count / totalVotes) * 100 : 0;
            const isWinner = showWinnerBanner && weeklyWinner?.name === r.choice;
            return (
              <li key={`${r.choice}-${idx}`} className={isWinner ? 'ring-2 ring-emerald-400 rounded-lg p-2' : ''}>
                <div className="flex justify-between mb-1">
                  <span className="font-medium">{r.choice}</span>
                  <span className="text-sm text-gray-500">{Math.round(percentage)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                  <div
                    className={`h-full ${colors[idx % colors.length]} transition-all duration-700`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
