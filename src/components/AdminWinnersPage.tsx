// src/components/AdminWinnersPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebaseConfig';
import {
  collection, getDocs, orderBy, query,
} from 'firebase/firestore';
import { ArrowLeft, Download, RefreshCw } from 'lucide-react';
import { btn, btnSize, cn, field, panel } from './ui/styles';

type WinnerRow = {
  week: string;
  winner: string;
  decidedAt?: any; // Firestore Timestamp | string | number
  choices?: string[];
  votes?: number;
  source?: 'weeklyOptions' | 'winners';
};

function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'object' && 'seconds' in v) return v.seconds * 1000;
  if (typeof v === 'string') { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; }
  if (typeof v === 'number') return v;
  return 0;
}

export default function AdminWinnersPage() {
  const [rows, setRows] = useState<WinnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const map = new Map<string, WinnerRow>(); // key = week

      // 1) winners collection (top-level docs like {week, winner, tally, decidedAt, choices})
      try {
        const qRef = query(collection(db, 'winners'), orderBy('decidedAt', 'desc'));
        const snap = await getDocs(qRef);
        snap.forEach(d => {
          const data = d.data() as any;
          const tally: Record<string, number> = data.tally || {};
          const votes = Object.values(tally).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
          if (data.week && data.winner) {
            map.set(data.week, {
              week: data.week,
              winner: data.winner,
              decidedAt: data.decidedAt,
              choices: data.choices || Object.keys(tally),
              votes,
              source: 'winners',
            });
          }
        });
      } catch (e) {
        console.warn('[AdminWinnersPage] winners query failed or empty:', e);
      }

      // 2) weeklyOptions collection (embedded winner object: { winner: { name, tally, decidedAt } })
      try {
        const snap = await getDocs(collection(db, 'weeklyOptions'));
        snap.forEach(d => {
          const data = d.data() as any;
          const week = (typeof data.week === 'string' && data.week.trim()) ? data.week : d.id;
          const w = data?.winner;
          if (w?.name) {
            const tally: Record<string, number> = w.tally || {};
            const votes = Object.values(tally).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
            // Prefer explicit winners-collection entry if both exist; otherwise take weeklyOptions
            if (!map.has(week)) {
              map.set(week, {
                week,
                winner: w.name,
                decidedAt: w.decidedAt,
                choices: Array.isArray(data.choices) ? data.choices : Object.keys(tally),
                votes,
                source: 'weeklyOptions',
              });
            }
          }
        });
      } catch (e) {
        console.warn('[AdminWinnersPage] weeklyOptions scan failed:', e);
      }

      // Sort by decidedAt desc
      const list = Array.from(map.values())
        .sort((a, b) => toMillis(b.decidedAt) - toMillis(a.decidedAt));

      setRows(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter(r =>
      r.week.toLowerCase().includes(f) ||
      (r.winner || '').toLowerCase().includes(f)
    );
  }, [rows, filter]);

  const handleExportCSV = () => {
    const header = ['Week', 'Winner', 'Decided At', 'Total Votes', 'Choices', 'Source'];
    const lines = [header.join(',')];
    filtered.forEach(r => {
      const decided = toMillis(r.decidedAt) ? new Date(toMillis(r.decidedAt)).toLocaleString() : '';
      const choicesStr = (r.choices || []).join('; ');
      lines.push(
        [
          `"${r.week}"`,
          `"${r.winner || ''}"`,
          `"${decided}"`,
          `"${r.votes ?? ''}"`,
          `"${choicesStr}"`,
          `"${r.source || ''}"`,
        ].join(',')
      );
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'winners.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight">Past winners</h1>
            <p className="mt-0.5 text-sm text-ink-subtle">
              <span data-numeric>{filtered.length}</span>{' '}
              {filtered.length === 1 ? 'week' : 'weeks'} on record
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
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by week or winner"
              aria-label="Filter winners"
              className={cn(field, 'sm:max-w-xs')}
            />
            <div className="ml-auto flex items-center gap-2">
              <button onClick={load} className={cn(btn.secondary, btnSize.sm)}>
                <RefreshCw size={15} strokeWidth={2.25} aria-hidden="true" />
                Refresh
              </button>
              <button onClick={handleExportCSV} className={cn(btn.primary, btnSize.sm)}>
                <Download size={15} strokeWidth={2.25} aria-hidden="true" />
                Export CSV
              </button>
            </div>
          </div>

          {loading ? (
            <div className="space-y-2 p-5" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-field bg-surface-muted" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-ink-subtle">
              {rows.length === 0
                ? 'No winners recorded yet. The first one lands when a voting window closes.'
                : 'Nothing matches that filter.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-border bg-surface-muted text-left">
                  <tr className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    <th scope="col" className="px-5 py-3">Week</th>
                    <th scope="col" className="px-5 py-3">Winner</th>
                    <th scope="col" className="px-5 py-3">Decided</th>
                    <th scope="col" className="px-5 py-3">Votes</th>
                    <th scope="col" className="px-5 py-3">Ballot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((r) => {
                    const decided = toMillis(r.decidedAt)
                      ? new Date(toMillis(r.decidedAt)).toLocaleString()
                      : '—';
                    return (
                      <tr key={`${r.source}-${r.week}`} className="transition-colors hover:bg-surface-muted">
                        <td className="px-5 py-3 font-medium" data-numeric>{r.week}</td>
                        <td className="px-5 py-3 font-semibold text-brand-800">{r.winner || '—'}</td>
                        <td className="px-5 py-3 text-ink-muted" data-numeric>{decided}</td>
                        <td className="px-5 py-3 text-ink-muted" data-numeric>{r.votes ?? '—'}</td>
                        <td className="px-5 py-3 text-ink-subtle">{(r.choices || []).join(', ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
