// src/components/AdminWinnersPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebaseConfig';
import {
  collection, getDocs, orderBy, query,
} from 'firebase/firestore';

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
    <div className="min-h-screen bg-gray-50 text-gray-800 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-xl border border-gray-200 shadow">
        <div className="flex items-center justify-between p-6 border-b">
          <h1 className="text-2xl font-bold">🏆 Previous Winners</h1>
          <div className="flex items-center gap-3">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by week or winner…"
              className="border rounded px-3 py-2 text-sm"
            />
            <button
              onClick={handleExportCSV}
              className="px-3 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded"
            >
              ⬇ Export CSV
            </button>
            <button
              onClick={load}
              className="px-3 py-2 text-sm bg-gray-600 hover:bg-gray-700 text-white rounded"
            >
              ↻ Refresh
            </button>
            <a href="/admin" className="text-blue-600 hover:underline text-sm">
              ← Back to Admin
            </a>
          </div>
        </div>

        {loading ? (
          <p className="p-6 text-center text-gray-500">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-center text-gray-500">No winners recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  <th className="text-left px-6 py-3">Week</th>
                  <th className="text-left px-6 py-3">Winner</th>
                  <th className="text-left px-6 py-3">Decided At</th>
                  <th className="text-left px-6 py-3">Total Votes</th>
                  <th className="text-left px-6 py-3">Choices</th>
                  </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.map((r) => {
                  const decided = toMillis(r.decidedAt)
                    ? new Date(toMillis(r.decidedAt)).toLocaleString()
                    : '—';
                  return (
                    <tr key={`${r.source}-${r.week}`} className="hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium">{r.week}</td>
                      <td className="px-6 py-3">{r.winner || '—'}</td>
                      <td className="px-6 py-3">{decided}</td>
                      <td className="px-6 py-3">{r.votes ?? '—'}</td>
                      <td className="px-6 py-3">{(r.choices || []).join(', ')}</td>
                      </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
