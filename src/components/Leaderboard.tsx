import { useEffect, useState } from 'react';
import { db } from '../../firebaseConfig';
import {
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
  doc
} from 'firebase/firestore';

const getWeekKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const week = Math.ceil((((+now - new Date(year, 0, 1).getTime()) / 86400000) + new Date(year, 0, 1).getDay() + 1) / 7);
  return `${year}-W${week}`;
};

const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-yellow-500', 'bg-pink-500', 'bg-red-500'];

export default function Leaderboard() {
  const [results, setResults] = useState<{ choice: string; count: number }[]>([]);
  const [weeklyChoices, setWeeklyChoices] = useState<string[]>([]);
  const [totalVotes, setTotalVotes] = useState(0);

  useEffect(() => {
    const weekKey = getWeekKey();

    const fetchWeeklyChoices = async () => {
      const weeklyDoc = await getDoc(doc(db, 'weeklyOptions', weekKey));
      if (weeklyDoc.exists()) {
        setWeeklyChoices(weeklyDoc.data().choices || []);
      }
    };

    const unsubscribeVotes = onSnapshot(
      query(collection(db, 'votes'), where('week', '==', weekKey)),
      (snap) => {
        const tally: Record<string, number> = {};
        snap.docs.forEach(doc => {
          const choice = doc.data().choice;
          tally[choice] = (tally[choice] || 0) + 1;
        });

        const sorted = weeklyChoices.map(choice => ({
          choice,
          count: tally[choice] || 0,
        })).sort((a, b) => b.count - a.count);

        setResults(sorted);
        setTotalVotes(snap.size);
      }
    );

    fetchWeeklyChoices();

    return () => unsubscribeVotes();
  }, [weeklyChoices.join(',')]);

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
              <li key={r.choice}>
                <div className="flex justify-between mb-1">
                  <span className="font-medium">{r.choice}</span>
                  <span className="text-sm text-gray-500">{Math.round(percentage)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-4 dark:bg-gray-700 overflow-hidden">
                  <div
                    className={`h-full ${colors[idx % colors.length]} transition-all duration-700`}
                    style={{ width: `${percentage}%` }}
                  ></div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
