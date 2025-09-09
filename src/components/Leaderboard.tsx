import { useEffect, useState } from 'react';
import { db } from '../../firebaseConfig';
import {
  collection,
  collectionGroup,
  query,
  where,
  onSnapshot,
  doc
} from 'firebase/firestore';
import { useWeekKey } from './utils/useWeekKey';
import { normalizeChoices } from './utils/normalizeChoices';

const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-yellow-500', 'bg-pink-500', 'bg-red-500'];

export default function Leaderboard() {
  const weekKey = useWeekKey();

  const [results, setResults] = useState<{ choice: string; count: number }[]>([]);
  const [weeklyChoices, setWeeklyChoices] = useState<string[]>([]);
  const [totalVotes, setTotalVotes] = useState(0);

  // Live subscribe to weekly options for current week
  useEffect(() => {
    if (!weekKey) return;
    const unsubWeekly = onSnapshot(doc(db, 'weeklyOptions', weekKey), (snap) => {
      if (snap.exists()) {
        const choices = normalizeChoices(snap.data()?.choices);
        setWeeklyChoices(choices);
      } else {
        setWeeklyChoices([]);
      }
    });
    return () => unsubWeekly();
  }, [weekKey]);

  // Live subscribe to votes (collection group => works for top-level and nested 'votes')
  useEffect(() => {
    if (!weekKey) return;

    let unsub: (() => void) | null = null;
    let usingFallback = false;

    const attach = () => {
      try {
        // Prefer collection group: picks up ANY 'votes' collection anywhere
        const qCG = query(collectionGroup(db, 'votes'), where('week', '==', weekKey));
        unsub = onSnapshot(qCG, (snap) => {
          const tally: Record<string, number> = {};
          snap.docs.forEach((d) => {
            const choice = String(d.data().choice ?? '').trim();
            if (!choice) return;
            tally[choice] = (tally[choice] || 0) + 1;
          });

          // Render all weekly choices, even with 0 votes
          const base = weeklyChoices.length ? weeklyChoices : Object.keys(tally);
          const unique = Array.from(new Set(base.map((s) => s.trim()).filter(Boolean)));

          const sorted = unique
            .map((choice) => ({ choice, count: tally[choice] || 0 }))
            .sort((a, b) => b.count - a.count);

          setResults(sorted);
          setTotalVotes(snap.size);
        }, (err) => {
          console.error('[Leaderboard] collectionGroup votes error:', err);
          // Fallback to top-level 'votes' if rules/indexes block collection group query
          if (!usingFallback) {
            usingFallback = true;
            if (unsub) unsub();
            const qTop = query(collection(db, 'votes'), where('week', '==', weekKey));
            unsub = onSnapshot(qTop, (snap) => {
              const tally: Record<string, number> = {};
              snap.docs.forEach((d) => {
                const choice = String(d.data().choice ?? '').trim();
                if (!choice) return;
                tally[choice] = (tally[choice] || 0) + 1;
              });

              const base = weeklyChoices.length ? weeklyChoices : Object.keys(tally);
              const unique = Array.from(new Set(base.map((s) => s.trim()).filter(Boolean)));

              const sorted = unique
                .map((choice) => ({ choice, count: tally[choice] || 0 }))
                .sort((a, b) => b.count - a.count);

              setResults(sorted);
              setTotalVotes(snap.size);
            }, (fallbackErr) => {
              console.error('[Leaderboard] top-level votes error:', fallbackErr);
            });
          }
        });
      } catch (outerErr) {
        console.error('[Leaderboard] attach votes listener error:', outerErr);
      }
    };

    attach();
    return () => {
      if (unsub) unsub();
    };
  }, [weekKey, weeklyChoices]);

  return (
    <div className="mb-10">
      <h2 className="text-2xl font-semibold mb-4 text-center">📊 Leaderboard</h2>

      {weeklyChoices.length === 0 ? (
        <p className="text-gray-500 text-center">Weekly options not set.</p>
      ) : (
        <ul className="space-y-4">
          {results.map((r, idx) => {
            const percentage = totalVotes > 0 ? (r.count / totalVotes) * 100 : 0;
            return (
              <li key={`${r.choice}-${idx}`}>
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
