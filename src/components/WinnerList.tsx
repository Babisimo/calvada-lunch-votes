import { useEffect, useState } from 'react';
import { db } from '../../firebaseConfig';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { Trophy } from 'lucide-react';
import { cn, panel, sectionTitle } from './ui/styles';

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
    <section className={cn(panel, 'p-5 sm:p-6')}>
      <div className="mb-4 flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-field bg-brand-50 text-brand-700"
        >
          <Trophy size={16} strokeWidth={2.25} />
        </span>
        <h2 className={sectionTitle}>Past winners</h2>
      </div>

      {items.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong px-4 py-6 text-center text-sm text-ink-subtle">
          No winners recorded yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const date = it.decidedAt
              ? new Date(it.decidedAt.seconds * 1000).toLocaleDateString()
              : '—';
            return (
              <li key={it.week} className="flex items-baseline justify-between gap-3 py-2.5">
                <span className="flex min-w-0 items-baseline gap-3">
                  <span data-numeric className="shrink-0 text-sm text-ink-subtle">{it.week}</span>
                  <span className="truncate font-semibold">{it.winner}</span>
                </span>
                <span data-numeric className="shrink-0 text-sm text-ink-subtle">{date}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
