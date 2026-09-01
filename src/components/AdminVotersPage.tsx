import { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy, where } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useWeekKey } from './utils/useWeekKey';
import { btn, btnSize, cn, field, panel } from './ui/styles';

interface Vote {
  name: string;
  email: string;
  choice: string;
  timestamp: string;
}

export default function AdminVotersPage() {
  const currentWeek = useWeekKey();
  const [week, setWeek] = useState('');
  const [voters, setVoters] = useState<Vote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Follow the live week until an admin types a different one.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!pinned && currentWeek) setWeek(currentWeek);
  }, [currentWeek, pinned]);

  useEffect(() => {
    let cancelled = false;

    async function fetchVotes() {
      setLoading(true);
      try {
        // This page used to load EVERY vote ever cast while claiming to show
        // the current week. Scoped to one week, and it stops growing forever.
        const constraints = week
          ? [where('week', '==', week), orderBy('createdAt', 'desc')]
          : [orderBy('createdAt', 'desc')];
        const snapshot = await getDocs(query(collection(db, 'votes'), ...constraints));

        const loadedVotes: Vote[] = snapshot.docs.map((doc) => {
          const data = doc.data() as any;
          const secs = data?.createdAt?.seconds ?? null;
          return {
            name: data.userName,
            email: data.userEmail,
            choice: data.choice,
            timestamp: secs
              ? new Date(secs * 1000).toLocaleString('en-US', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })
              : '—',
          };
        });
        if (!cancelled) setVoters(loadedVotes);
      } catch (err) {
        console.error('Failed to fetch votes:', err);
        if (!cancelled) setVoters([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchVotes();
    return () => {
      cancelled = true;
    };
  }, [week, refreshNonce]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight">Who voted</h1>
            <p className="mt-0.5 text-sm text-ink-subtle">
              <span data-numeric>{voters.length}</span>{' '}
              {voters.length === 1 ? 'vote' : 'votes'}
              {week ? ' in ' : ' across all weeks'}
              {week && <b className="font-semibold text-ink-muted" data-numeric>{week}</b>}
            </p>
          </div>
          <a href="/admin" className={cn(btn.secondary, btnSize.sm)}>
            <ArrowLeft size={15} strokeWidth={2.25} aria-hidden="true" />
            Back to admin
          </a>
        </div>

        <div className={cn(panel, 'overflow-hidden')}>
          <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-3.5">
            <input
              value={week}
              onChange={(e) => {
                setPinned(true);
                setWeek(e.target.value.trim());
              }}
              placeholder="All weeks"
              aria-label="Week to show"
              data-numeric
              className={cn(field, 'sm:max-w-[12rem]')}
            />
            {pinned && currentWeek && week !== currentWeek && (
              <button
                onClick={() => {
                  setPinned(false);
                  setWeek(currentWeek);
                }}
                className={btn.quiet}
              >
                Back to {currentWeek}
              </button>
            )}
            <button
              onClick={() => setRefreshNonce((n) => n + 1)}
              className={cn(btn.secondary, btnSize.sm, 'ml-auto')}
            >
              <RefreshCw size={15} strokeWidth={2.25} aria-hidden="true" />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="space-y-2 p-5" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-field bg-surface-muted" />
              ))}
            </div>
          ) : voters.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-ink-subtle">
              <span aria-hidden="true" className="mr-1.5">🗳️</span>
              No votes {week ? `in ${week}` : 'yet'}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-border bg-surface-muted text-left">
                  <tr className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    <th scope="col" className="px-5 py-3">Choice</th>
                    <th scope="col" className="px-5 py-3">Voter</th>
                    <th scope="col" className="px-5 py-3">Voted at</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {voters.map((vote, index) => (
                    <tr key={index} className="transition-colors hover:bg-surface-muted">
                      <td className="px-5 py-3 font-medium">{vote.choice}</td>
                      <td className="px-5 py-3 text-ink-muted">{vote.email}</td>
                      <td className="px-5 py-3 text-ink-muted" data-numeric>{vote.timestamp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
