import { useEffect, useState } from 'react';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  onSnapshot,
  doc
} from 'firebase/firestore';
import { db, auth, loginWithGoogle } from '../../firebaseConfig';
import toast, { Toaster } from 'react-hot-toast';
import confetti from 'canvas-confetti';

const getWeekKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const week = Math.ceil(
    ((+now - new Date(year, 0, 1).getTime()) / 86400000 + new Date(year, 0, 1).getDay() + 1) / 7
  );
  return `${year}-W${week}`;
};

function formatCountdown(ms: number) {
  if (ms <= 0) return 'Voting closed';

  const totalSeconds = Math.floor(ms / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  return `${d}d ${h}h ${m}m ${s}s`;
}

export default function Voting({ user }: { user: any }) {
  const [selected, setSelected] = useState('');
  const [hasVoted, setHasVoted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [choices, setChoices] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [voteStart, setVoteStart] = useState(0);
  const [voteEnd, setVoteEnd] = useState(0);
  const [now, setNow] = useState(Date.now());

  const weekKey = getWeekKey();
  const canVote = now >= voteStart && now <= voteEnd;

  useEffect(() => {
    const unsubOptions = onSnapshot(query(collection(db, 'weeklyOptions'), where('week', '==', weekKey)), (snap) => {
      const match = snap.docs.find((doc) => doc.id === weekKey);
      setChoices(match?.data().choices || []);
      setLoadingOptions(false);
    });

    const unsubConfig = onSnapshot(doc(db, 'config', 'votingConfig'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const start = data.start ? new Date(data.start).getTime() : 0;
        const end = data.end ? new Date(data.end).getTime() : 0;
        setVoteStart(start);
        setVoteEnd(end);
      }
    });

    return () => {
      unsubOptions();
      unsubConfig();
    };
  }, [weekKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function checkVote() {
      const q = query(
        collection(db, 'votes'),
        where('userId', '==', user.uid),
        where('week', '==', weekKey)
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) setHasVoted(true);
    }

    if (user && canVote) checkVote();
  }, [user, canVote, weekKey]);

  async function castVote() {
    if (!selected || isSubmitting) return;
    if (!auth.currentUser) {
      await loginWithGoogle();
      return;
    }

    if (!user.email.endsWith('@calvada.com')) {
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
        <p>🕒 Voting is currently closed.</p>
        {voteStart > now && (
          <p>
            Opens in: <b>{formatCountdown(voteStart - now)}</b>
          </p>
        )}
      </div>
    );
  }

  if (loadingOptions) {
    return <p className="text-center text-gray-400">Loading options...</p>;
  }

  if (!choices.length) {
    return (
      <p className="text-center text-gray-500">
        No options configured for this week. Admins need to regenerate the menu!
      </p>
    );
  }

  if (hasVoted) {
    return (
      <p className="text-center text-green-600">
        ✅ You’ve already voted this week.
      </p>
    );
  }

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
