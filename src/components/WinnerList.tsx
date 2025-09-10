import { useEffect, useState } from 'react';
import { db } from '../../firebaseConfig';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';

type WinnerListItem = {
  week: string;
  winner: string;
  decidedAt?: { seconds: number; nanoseconds: number };
};

export default function WinnersList() {
  const [items, setItems] = useState<WinnerListItem[]>([]);

  useEffect(() => {
    const run = async () => {
      try {
        const q = query(
          collection(db, 'weeklyOptions'),
          where('winner.decidedAt', '>', new Date(0)),
          orderBy('winner.decidedAt', 'desc')
        );
        const snap = await getDocs(q);
        const arr: WinnerListItem[] = [];
        snap.forEach(d => {
          const data = d.data() as any;
          arr.push({
            week: data.week || d.id,
            winner: data?.winner?.name || '—',
            decidedAt: data?.winner?.decidedAt,
          });
        });
        setItems(arr);
      } catch (err) {
        console.error('[WinnersList] load error:', err);
        setItems([]);
      }
    };
    run();
  }, []);

  return (
    <div className="max-w-xl mx-auto bg-white rounded-xl border border-gray-200 shadow p-6">
      <h3 className="text-xl font-semibold mb-4">🏆 Past Winners</h3>
      {items.length === 0 ? (
        <p className="text-gray-500">No winners recorded yet.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => {
            const date = it.decidedAt
              ? new Date(it.decidedAt.seconds * 1000).toLocaleString()
              : '—';
            return (
              <li key={it.week} className="flex justify-between items-center">
                <span className="font-medium">{it.week}</span>
                <span className="text-gray-800">{it.winner}</span>
                <span className="text-sm text-gray-500">{date}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
