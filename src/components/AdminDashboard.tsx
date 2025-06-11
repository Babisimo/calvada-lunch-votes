import { useEffect, useState } from 'react';
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  setDoc,
  onSnapshot
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import toast, { Toaster } from 'react-hot-toast';
import MenuAdmin from './MenuAdmin';
import { useNavigate } from 'react-router-dom';

const getWeekKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const week = Math.ceil(
    ((+now - new Date(year, 0, 1).getTime()) / 86400000 + new Date(year, 0, 1).getDay() + 1) / 7
  );
  return `${year}-W${week}`;
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [admins, setAdmins] = useState<{ email: string }[]>([]);
  const [newAdmin, setNewAdmin] = useState('');
  const [loading, setLoading] = useState(true);
  const [showMenuEditor, setShowMenuEditor] = useState(false);
  const [weeklyChoices, setWeeklyChoices] = useState<string[]>([]);
  const [hasVotes, setHasVotes] = useState(false);
  const weekKey = getWeekKey();

  useEffect(() => {
    async function loadAdmins() {
      const snapshot = await getDocs(collection(db, 'admins'));
      setAdmins(snapshot.docs.map((doc) => ({ email: doc.id })));
      setLoading(false);
    }
    loadAdmins();
  }, []);

  useEffect(() => {
    const unsubOptions = onSnapshot(doc(db, 'weeklyOptions', weekKey), (snap) => {
      setWeeklyChoices(snap.exists() ? snap.data().choices || [] : []);
    });

    const unsubVotes = onSnapshot(collection(db, 'votes'), (snap) => {
      const votedThisWeek = snap.docs.some(doc => doc.data().week === weekKey);
      setHasVotes(votedThisWeek);
    });

    return () => {
      unsubOptions();
      unsubVotes();
    };
  }, [weekKey]);

  const addAdmin = async () => {
    if (!newAdmin.trim()) return;
    try {
      await setDoc(doc(db, 'admins', newAdmin.trim()), {});
      setAdmins((prev) => [...prev, { email: newAdmin.trim() }]);
      setNewAdmin('');
      toast.success('Admin added!');
    } catch (err) {
      toast.error('Failed to add admin');
      console.error(err);
    }
  };

  const removeAdmin = async (email: string) => {
    if (!confirm(`Remove ${email} from admins?`)) return;
    try {
      await deleteDoc(doc(db, 'admins', email));
      setAdmins((prev) => prev.filter((a) => a.email !== email));
      toast.success('Admin removed');
    } catch (err) {
      toast.error('Failed to remove');
      console.error(err);
    }
  };

  const handleResetVotes = async () => {
    if (!confirm('Are you sure you want to delete ALL votes? This cannot be undone.')) return;
    try {
      const votesSnap = await getDocs(collection(db, 'votes'));
      const deleteOps = votesSnap.docs.map((vote) =>
        deleteDoc(doc(db, 'votes', vote.id))
      );
      await Promise.all(deleteOps);
      toast.success('✅ All votes have been reset!');
    } catch (err) {
      toast.error('Failed to reset votes');
      console.error(err);
    }
  };

  const regenerateWeeklyOptions = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'menu'));
      const allOptions = snapshot.docs.map(doc => doc.data().name);
      if (allOptions.length < 4) {
        toast.error('Need at least 4 menu items to regenerate weekly options.');
        return;
      }

      const shuffled = [...allOptions].sort(() => 0.5 - Math.random()).slice(0, 4);
      await setDoc(doc(db, 'weeklyOptions', weekKey), {
        choices: shuffled,
        week: weekKey,
      });

      toast.success('✅ New weekly options generated!');
    } catch (err) {
      toast.error('Failed to regenerate weekly options');
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100 transition-colors">
      <Toaster position="top-center" />

      {/* Sticky Header */}
      <header className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 shadow-sm flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">🛠️ Admin Dashboard</h1>
        <button
          onClick={() => navigate('/votes')}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline transition"
        >
          Votes
        </button>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline transition"
        >
          ⬅ Back to Leaderboard
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-12">
        {/* Weekly Options Section */}
        <section className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold mb-4 text-center">📊 This Week's Options</h3>

          {weeklyChoices.length > 0 ? (
            <ul className="space-y-2 text-left mb-4">
              {weeklyChoices.map((choice, index) => (
                <li
                  key={index}
                  className="px-4 py-2 bg-gray-50 dark:bg-gray-700 rounded text-gray-900 dark:text-gray-100"
                >
                  {index + 1}. {choice}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center text-gray-500 mb-4">No weekly options generated yet.</p>
          )}

          <button
            onClick={regenerateWeeklyOptions}
            disabled={hasVotes}
            className={`w-full py-3 text-white rounded-lg font-semibold shadow transition-all ${
              hasVotes
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:shadow-md'
            }`}
          >
            🔄 Regenerate This Week’s Options
          </button>

          {hasVotes && (
            <p className="text-sm text-red-500 mt-2 text-center">
              Cannot regenerate after voting has started.
            </p>
          )}
        </section>

        {/* Toggle Menu Editor */}
        <div className="text-center">
          <button
            onClick={() => setShowMenuEditor(!showMenuEditor)}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-md transition-all"
          >
            {showMenuEditor ? '🔽 Hide Menu Editor' : '📋 Show Menu Editor'}
          </button>
        </div>

        {/* Menu Admin */}
        {showMenuEditor && <MenuAdmin />}

        {/* Admin Management */}
        <section className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold mb-4 text-center">👤 Manage Admins</h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-6">
            <input
              type="email"
              value={newAdmin}
              onChange={(e) => setNewAdmin(e.target.value)}
              placeholder="Enter admin email"
              className="px-4 py-2 w-full sm:w-auto border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded"
            />
            <button
              onClick={addAdmin}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
            >
              ➕ Add
            </button>
          </div>
          {loading ? (
            <p className="text-center text-gray-500">Loading admins...</p>
          ) : (
            <ul className="space-y-2">
              {admins.map(({ email }) => (
                <li
                  key={email}
                  className="flex justify-between items-center px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded"
                >
                  <span>{email}</span>
                  <button
                    onClick={() => removeAdmin(email)}
                    className="text-red-500 hover:underline text-sm"
                  >
                    ❌ Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Reset Votes */}
        <div className="text-center">
          <button
            onClick={handleResetVotes}
            className="w-full py-3 bg-red-900 hover:bg-red-700 text-white rounded-lg font-semibold shadow-md transition-all"
          >
            🧨 Reset All Votes
          </button>
        </div>
      </main>
    </div>
  );
}
