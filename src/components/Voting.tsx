import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  onSnapshot,
  doc,
} from 'firebase/firestore';
import { db, auth, loginWithGoogle } from '../../firebaseConfig';
import toast, { Toaster } from 'react-hot-toast';
import confetti from 'canvas-confetti';
import { useWeekKey } from './utils/useWeekKey';
import { normalizeChoices } from './utils/normalizeChoices';
import { decideAndPersistWinnerInWeeklyDoc, type WeeklyWinner } from './services/winner';

function formatCountdown(ms: number) {
  if (ms <= 0) return 'Voting closed';
  const totalSeconds = Math.floor(ms / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}
function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'string') { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; }
  if (typeof v === 'number') return v;
  return 0;
}

export default function Voting({ user }: { user: any }) {
  const weekKey = useWeekKey();

  const [selected, setSelected] = useState('');
  const [hasVoted, setHasVoted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [choices, setChoices] = useState<string[]>([]);
  const [weeklyUpdatedAtMs, setWeeklyUpdatedAtMs] = useState(0);
  const [weeklyWinner, setWeeklyWinner] = useState<WeeklyWinner | null>(null);

  const [loadingOptions, setLoadingOptions] = useState(true);
  const [voteStart, setVoteStart] = useState(0);
  const [voteEnd, setVoteEnd] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [totalVotes, setTotalVotes] = useState(0);
  const hasCelebratedRef = useRef(false);

  const canVote = useMemo(() => now >= voteStart && now <= voteEnd, [now, voteStart, voteEnd]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // options + winner
  useEffect(() => {
    if (!weekKey) return;
    setLoadingOptions(true);
    const unsub = onSnapshot(doc(db, 'weeklyOptions', weekKey), (snap) => {
      if (!snap.exists()) {
        setChoices([]);
        setWeeklyUpdatedAtMs(0);
        setWeeklyWinner(null);
        setLoadingOptions(false);
        return;
      }
      const data = snap.data() as any;
      setChoices(normalizeChoices(data?.choices));
      setWeeklyUpdatedAtMs(toMillis(data?.updatedAt));
      setWeeklyWinner((data?.winner ?? null) as WeeklyWinner | null);
      setLoadingOptions(false);
    }, () => setLoadingOptions(false));
    return () => unsub();
  }, [weekKey]);

  // votes count (to suppress banner on zero votes)
  useEffect(() => {
    if (!weekKey) return;
    const qVotes = query(collection(db, 'votes'), where('week', '==', weekKey));
    const unsub = onSnapshot(qVotes, (snap) => setTotalVotes(snap.size));
    return () => unsub();
  }, [weekKey]);

  // clear selection if options changed
  useEffect(() => {
    if (selected && !choices.includes(selected)) setSelected('');
  }, [choices, selected]);

  // voting window
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'votingConfig'), (snap) => {
      if (!snap.exists()) { setVoteStart(0); setVoteEnd(0); return; }
      const data = snap.data();
      setVoteStart(toMillis(data?.startTime ?? data?.start));
      setVoteEnd(toMillis(data?.endTime ?? data?.end));
    });
    return () => unsub();
  }, []);

  // already voted?
  useEffect(() => {
    async function checkVote() {
      if (!user?.uid || !weekKey) return;
      const qVotes = query(
        collection(db, 'votes'),
        where('userId', '==', user.uid),
        where('week', '==', weekKey)
      );
      const snapshot = await getDocs(qVotes);
      setHasVoted(!snapshot.empty);
    }
    if (user && weekKey) checkVote();
  }, [user, weekKey]);

  // banner gating (also requires totalVotes > 0)
  const decidedAtMs = toMillis(weeklyWinner?.decidedAt);
  const shouldShowWinnerBanner =
    !!weeklyWinner?.name &&
    voteEnd > 0 &&
    now >= voteEnd &&
    totalVotes > 0 &&
    (weeklyUpdatedAtMs === 0 || decidedAtMs >= weeklyUpdatedAtMs);

  // Decide winner when window ends (NO-OP if zero votes)
  useEffect(() => {
    const isOver = voteEnd > 0 && now >= voteEnd;
    if (!isOver || !weekKey) return;
    if (!weeklyWinner || decidedAtMs < weeklyUpdatedAtMs) {
      decideAndPersistWinnerInWeeklyDoc(weekKey).catch((e) =>
        console.error('[Voting] decide winner error', e)
      );
    }
  }, [now, voteEnd, weekKey, weeklyWinner, decidedAtMs, weeklyUpdatedAtMs]);

  // Celebrate once when banner becomes visible
  useEffect(() => {
    if (shouldShowWinnerBanner && !hasCelebratedRef.current) {
      confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
      setTimeout(() => confetti({ particleCount: 120, spread: 100, origin: { y: 0.7 } }), 350);
      hasCelebratedRef.current = true;
    }
  }, [shouldShowWinnerBanner]);

  async function castVote() {
    if (!selected || isSubmitting) return;

    if (!auth.currentUser) {
      await loginWithGoogle();
      return;
    }
    if (!user?.email?.endsWith?.('@calvada.com')) {
      toast.error('Only @calvada.com emails can vote');
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'votes'), {
        userId: user.uid,
        userName: user.displayName,
        userEmail: user.email,
        choice: selected,
        week: weekKey,
        createdAt: serverTimestamp(),
      });
      toast.success('Vote submitted 🎉');
      confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
      setHasVoted(true);
    } catch (err) {
      toast.error('Something went wrong');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!canVote) {
    return (
      <div className="text-center text-gray-500">
        <Toaster position="top-center" />
        {shouldShowWinnerBanner ? (
          <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-800">
            {(() => {
              const msgs = [
                "We're eating ___ this week! 🎉",
                '___ won! 👑',
                'Cravings secured: ___ 😋',
                'The people have spoken: ___! 🗳️',
              ];
              const idx = decidedAtMs ? decidedAtMs % msgs.length : 0;
              return msgs[idx].replace('___', weeklyWinner?.name ?? '');
            })()}
          </div>
        ) : null}
        <p>🕒 Voting is currently closed.</p>
        {voteStart > now && (
          <p>
            Opens in: <b>{formatCountdown(voteStart - now)}</b>
          </p>
        )}
      </div>
    );
  }

  if (loadingOptions) return <p className="text-center text-gray-400">Loading options...</p>;
  if (!choices.length) return <p className="text-center text-gray-500">No options configured for this week.</p>;
  if (hasVoted) return <p className="text-center text-green-600">✅ You’ve already voted this week.</p>;

  return (
    <div className="mb-10">
      <Toaster position="top-center" />
      <h2 className="text-2xl font-semibold mb-4 text-center">Choose this week's lunch</h2>

      <div className="text-center mb-4 text-sm text-gray-600">
        ⏳ Time left to vote: <b>{formatCountdown(voteEnd - now)}</b>
      </div>

      <ul className="space-y-3 mb-6">
        {choices.map((opt) => (
          <li key={opt}>
            <label className="flex items-center space-x-3">
              <input
                type="radio"
                name="lunch"
                value={opt}
                checked={selected === opt}
                onChange={() => setSelected(opt)}
                className="accent-blue-500 w-5 h-5"
              />
              <span className="text-lg font-medium">{opt}</span>
            </label>
          </li>
        ))}
      </ul>

      <button
        onClick={castVote}
        disabled={!selected || isSubmitting}
        className={`w-full py-3 text-black rounded-md transition-all text-center text-lg font-semibold 
          ${isSubmitting || !selected
            ? 'bg-blue-300 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 shadow-md'}`}
      >
        {isSubmitting ? 'Submitting...' : '✅ Submit Vote'}
      </button>
    </div>
  );
}
