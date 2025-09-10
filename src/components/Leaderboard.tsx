import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../firebaseConfig';
import {
  collection, collectionGroup, query, where, onSnapshot, doc
} from 'firebase/firestore';
import { useWeekKey } from './utils/useWeekKey';
import { normalizeChoices } from './utils/normalizeChoices';
import { decideAndPersistWinnerInWeeklyDoc, type WeeklyWinner } from './services/winner';
import confetti from 'canvas-confetti';

const colors = ['bg-blue-500','bg-green-500','bg-purple-500','bg-yellow-500','bg-pink-500','bg-red-500'];
const CELEBRATION_MESSAGES = [
  "We're eating ___ this week! 🎉",
  "___ won! 👑",
  "Victory! ___ takes the crown!",
  "Cravings secured: ___ 😋",
  "The people have spoken: ___! 🗳️",
  "Lunch destiny: ___ 🚀",
];

function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'string') { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; }
  if (typeof v === 'number') return v;
  return 0;
}

export default function Leaderboard() {
  const weekKey = useWeekKey();

  const [weeklyChoices, setWeeklyChoices] = useState<string[]>([]);
  const [weeklyUpdatedAtMs, setWeeklyUpdatedAtMs] = useState<number>(0);
  const [weeklyWinner, setWeeklyWinner] = useState<WeeklyWinner | null>(null);

  const [results, setResults] = useState<{ choice: string; count: number }[]>([]);
  const [totalVotes, setTotalVotes] = useState(0);
  const [endTimeMs, setEndTimeMs] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const hasCelebratedRef = useRef(false);

  // tick
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // weekly options (+ updatedAt + embedded winner)
  useEffect(() => {
    if (!weekKey) return;
    const unsub = onSnapshot(doc(db, 'weeklyOptions', weekKey), (snap) => {
      if (!snap.exists()) { setWeeklyChoices([]); setWeeklyUpdatedAtMs(0); setWeeklyWinner(null); return; }
      const data = snap.data();
      setWeeklyChoices(normalizeChoices(data?.choices));
      setWeeklyUpdatedAtMs(toMillis(data?.updatedAt));
      setWeeklyWinner((data?.winner ?? null) as WeeklyWinner | null);
    });
    return () => unsub();
  }, [weekKey]);

  // votes (collectionGroup with fallback)
  useEffect(() => {
    if (!weekKey) return;
    let unsub: (() => void) | null = null;
    let fallback = false;

    const attach = () => {
      try {
        const qCG = query(collectionGroup(db, 'votes'), where('week', '==', weekKey));
        unsub = onSnapshot(qCG, (snap) => {
          const tally: Record<string, number> = {};
          snap.forEach(d => {
            const c = String(d.data().choice ?? '').trim();
            if (!c) return;
            tally[c] = (tally[c] || 0) + 1;
          });
          const base = weeklyChoices.length ? weeklyChoices : Object.keys(tally);
          const unique = Array.from(new Set(base.map(s => s.trim()).filter(Boolean)));
          const sorted = unique.map(choice => ({ choice, count: tally[choice] || 0 }))
                               .sort((a,b) => b.count - a.count);
          setResults(sorted);
          setTotalVotes(snap.size);
        }, (err) => {
          console.error('[Leaderboard] collectionGroup error:', err);
          if (!fallback) {
            fallback = true;
            if (unsub) unsub();
            const qTop = query(collection(db, 'votes'), where('week', '==', weekKey));
            unsub = onSnapshot(qTop, (snap) => {
              const tally: Record<string, number> = {};
              snap.forEach(d => {
                const c = String(d.data().choice ?? '').trim();
                if (!c) return;
                tally[c] = (tally[c] || 0) + 1;
              });
              const base = weeklyChoices.length ? weeklyChoices : Object.keys(tally);
              const unique = Array.from(new Set(base.map(s => s.trim()).filter(Boolean)));
              const sorted = unique.map(choice => ({ choice, count: tally[choice] || 0 }))
                                   .sort((a,b) => b.count - a.count);
              setResults(sorted);
              setTotalVotes(snap.size);
            });
          }
        });
      } catch (e) {
        console.error('[Leaderboard] attach votes error:', e);
      }
    };

    attach();
    return () => { if (unsub) unsub(); };
  }, [weekKey, weeklyChoices]);

  // voting window end
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'votingConfig'), (snap) => {
      if (!snap.exists()) { setEndTimeMs(null); return; }
      const data = snap.data();
      const endMs = toMillis(data?.endTime ?? data?.end);
      setEndTimeMs(endMs || null);
    });
    return () => unsub();
  }, []);

  // Banner gating: only after voting ends AND winner decided after latest options update
  // AND there was at least one vote
  const decidedAtMs = toMillis(weeklyWinner?.decidedAt);
  const shouldShowWinnerBanner =
    !!weeklyWinner?.name &&
    !!endTimeMs &&
    now >= endTimeMs &&
    totalVotes > 0 &&
    (weeklyUpdatedAtMs === 0 || decidedAtMs >= weeklyUpdatedAtMs);

  // Decide winner once when window ends (service NO-OPs if zero votes)
  useEffect(() => {
    const isOver = !!endTimeMs && now >= endTimeMs;
    if (!isOver || !weekKey) return;
    if (!weeklyWinner || decidedAtMs < weeklyUpdatedAtMs) {
      decideAndPersistWinnerInWeeklyDoc(weekKey).catch((e) =>
        console.error('[Leaderboard] decide winner error', e)
      );
    }
  }, [endTimeMs, now, weekKey, weeklyWinner, decidedAtMs, weeklyUpdatedAtMs]);

  // Fire confetti ONCE when the banner becomes visible
  useEffect(() => {
    if (shouldShowWinnerBanner && !hasCelebratedRef.current) {
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.7 } });
      setTimeout(() => confetti({ particleCount: 60, spread: 90, startVelocity: 45, origin: { y: 0.6 } }), 300);
      setTimeout(() => confetti({ particleCount: 120, spread: 100, origin: { y: 0.8 } }), 650);
      hasCelebratedRef.current = true;
    }
  }, [shouldShowWinnerBanner]);

  // Deterministic single-line banner text (prevents double messages)
  const bannerText = useMemo(() => {
    if (!weeklyWinner?.name) return '';
    const idx = decidedAtMs ? decidedAtMs % CELEBRATION_MESSAGES.length : 0;
    return CELEBRATION_MESSAGES[idx].replace('___', weeklyWinner.name);
  }, [weeklyWinner?.name, decidedAtMs]);

  return (
    <div className="mb-10">
      <h2 className="text-2xl font-semibold mb-4 text-center">📊 Leaderboard</h2>

      {shouldShowWinnerBanner && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-center shadow-sm">
          <div className="text-lg font-semibold text-emerald-800">{bannerText}</div>
        </div>
      )}

      {weeklyChoices.length === 0 ? (
        <p className="text-gray-500 text-center">Weekly options not set.</p>
      ) : (
        <ul className="space-y-4">
          {results.map((r, idx) => {
            const percentage = totalVotes > 0 ? (r.count / totalVotes) * 100 : 0;
            const isWinner = shouldShowWinnerBanner && weeklyWinner?.name === r.choice;
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
