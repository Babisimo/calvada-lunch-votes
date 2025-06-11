import { useEffect, useState } from 'react';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  onSnapshot,
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

export default function Voting({ user }: { user: any }) {
  const [selected, setSelected] = useState('');
  const [hasVoted, setHasVoted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [choices, setChoices] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const weekKey = getWeekKey();
  const canVote = [3, 4, 5].includes(new Date().getDay()); // Wed–Fri

  useEffect(() => {
    const q = query(collection(db, 'weeklyOptions'), where('week', '==', weekKey));
    const unsub = onSnapshot(q, (snap) => {
      const match = snap.docs.find((doc) => doc.id === weekKey);
      setChoices(match?.data().choices || []);
      setLoadingOptions(false);
    });

    return unsub;
  }, [weekKey]);

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
      <p className="text-center text-gray-500">
        Voting opens on <b>Wednesday</b> and closes <b>Friday</b>.
      </p>
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
            : 'bg-blue-600 hover:bg-blue-700 shadow-md'}
        `}
      >
        {isSubmitting ? 'Submitting...' : '✅ Submit Vote'}
      </button>
    </div>
  );
}
