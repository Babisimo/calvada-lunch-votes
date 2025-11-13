// src/components/AdminDashboard.tsx
import { useEffect, useState } from 'react';
import {
  collection,
  collectionGroup,
  getDocs,
  deleteDoc,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import toast, { Toaster } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import VotingTimerAdmin from './VotingTimerAdmin';
import MenuAdmin from './MenuAdmin';
import AdminWeekControl from './AdminWeekControl';

import { useWeekKey } from './utils/useWeekKey';
import { normalizeChoices } from './utils/normalizeChoices';
import { subscribeWeeklyOptions } from './utils/subscribeWeeklyOptions';
import { clearWinnerOnce } from './utils/maintenance/clearWinnerOnce';

// add this inside the component, TEMPORARILY:
;(window as any).clearWinnerOnce = clearWinnerOnce;

export default function AdminDashboard() {
  const navigate = useNavigate();

  // admins
  const [admins, setAdmins] = useState<{ email: string }[]>([]);
  const [newAdmin, setNewAdmin] = useState('');
  const [loadingAdmins, setLoadingAdmins] = useState(true);

  // weekly options
  const weekKey = useWeekKey();
  const [weeklyChoices, setWeeklyChoices] = useState<string[]>([]);
  const [hasVotes, setHasVotes] = useState(false);

  
  // ===== Admin list =====
  useEffect(() => {
    async function loadAdmins() {
      const snapshot = await getDocs(collection(db, 'admins'));
      setAdmins(snapshot.docs.map((d) => ({ email: d.id })));
      setLoadingAdmins(false);
    }
    loadAdmins();
  }, []);

  // ===== Weekly options (resilient) + hasVotes for current week =====
  useEffect(() => {
    // Subscribe to weekly options (by doc id with fallback by field)
    if (!weekKey) {
      setWeeklyChoices([]);
      setHasVotes(false);
      return;
    }

    const unsubOptions = subscribeWeeklyOptions(weekKey, (data) => {
      if (!data) {
        setWeeklyChoices([]);
        return;
      }
      setWeeklyChoices(normalizeChoices(data.choices));
    });

    // Watch votes for JUST this week (collectionGroup -> supports nested if you move votes later)
    const qVotes = query(collectionGroup(db, 'votes'), where('week', '==', weekKey));
    const unsubVotes = onSnapshot(
      qVotes,
      (snap) => setHasVotes(!snap.empty),
      (err) => {
        // Fallback to top-level /votes if collectionGroup not permitted
        console.warn('[AdminDashboard] votes collectionGroup failed, falling back:', err?.message);
        const qTop = query(collection(db, 'votes'), where('week', '==', weekKey));
        const unsubTop = onSnapshot(qTop, (snapTop) => setHasVotes(!snapTop.empty));
        // Return fallback unsubscriber on error
        return () => unsubTop();
      }
    );

    return () => {
      unsubOptions?.();
      unsubVotes?.();
    };
  }, [weekKey]);

  // ===== Admin actions =====
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
      const deleteOps = votesSnap.docs.map((vote) => deleteDoc(doc(db, 'votes', vote.id)));
      await Promise.all(deleteOps);
      toast.success('✅ All votes have been reset!');
    } catch (err) {
      toast.error('Failed to reset votes');
      console.error(err);
    }
  };

  const regenerateWeeklyOptions = async () => {
    if (!weekKey) {
      toast.error('Set the Current Week first (e.g., 2025-W43).');
      return;
    }
    try {
      const snapshot = await getDocs(collection(db, 'menu'));
      const allOptions = snapshot.docs
        .map((d) => (d.data().name ?? '').toString().trim())
        .filter(Boolean);

      if (allOptions.length < 4) {
        toast.error('Need at least 4 menu items to regenerate weekly options.');
        return;
      }

      const shuffled = [...allOptions].sort(() => 0.5 - Math.random()).slice(0, 4);
      await setDoc(
        doc(db, 'weeklyOptions', weekKey),
        {
          choices: shuffled,
          week: weekKey,
          updatedAt: serverTimestamp(),
          // preserve existing winner if present – omit it on purpose here
        },
        { merge: true }
      );

      toast.success(`✅ New weekly options generated for ${weekKey}!`);
    } catch (err) {
      toast.error('Failed to regenerate weekly options');
      console.error(err);
    }
  };

  const handleRemoveWeeklyOption = async (choice: string) => {
    if (!weekKey) {
      toast.error('Set the Current Week first.');
      return;
    }
    if (!confirm(`Remove "${choice}" from this week's options?`)) return;
    try {
      const updated = weeklyChoices.filter((item) => item !== choice);
      await setDoc(
        doc(db, 'weeklyOptions', weekKey),
        {
          choices: updated,
          week: weekKey,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      toast.success('Option removed!');
    } catch (err) {
      toast.error('Failed to remove option');
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      <Toaster position="top-center" />

      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 shadow-sm flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">🛠️ Admin Dashboard</h1>
        <div className="space-x-4">
          <button
            onClick={() => navigate('/votes')}
            className="text-sm text-blue-600 hover:underline transition"
          >
            Votes
          </button>
          <button
            onClick={() => navigate('/admin/winners')}
            className="text-sm text-blue-600 hover:underline transition"
          >
            Winners
          </button>
          <button
            onClick={() => navigate('/')}
            className="text-sm text-blue-600 hover:underline transition"
          >
            ⬅ Back to Leaderboard
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-2xl mx-auto px-6 py-10 space-y-12">
        {/* 🗓️ Current Week control (Save / New Week) */}
        <AdminWeekControl />

        {/* 📊 This Week's Options */}
        <section className="bg-white p-6 rounded-xl shadow border border-gray-200">
          <h3 className="text-lg font-semibold mb-1 text-center">
            📊 This Week&apos;s Options {weekKey ? <span className="text-gray-500">({weekKey})</span> : null}
          </h3>
          {!weekKey && (
            <p className="text-center text-red-600 mb-4">
              Set the Current Week above to manage options.
            </p>
          )}

          {weeklyChoices.length > 0 ? (
            <ul className="space-y-2 text-left mb-4">
              {weeklyChoices.map((choice, index) => (
                <li
                  key={`${choice}-${index}`}
                  className="flex justify-between items-center px-4 py-2 bg-gray-50 rounded text-gray-900"
                >
                  <span>{index + 1}. {choice}</span>
                  <button
                    onClick={() => handleRemoveWeeklyOption(choice)}
                    className="text-red-500 text-sm hover:underline"
                  >
                    ❌ Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center text-gray-500 mb-4">No weekly options generated yet.</p>
          )}

          <button
            onClick={regenerateWeeklyOptions}
            disabled={hasVotes || !weekKey}
            className={`w-full py-3 text-white rounded-lg font-semibold shadow transition-all ${hasVotes || !weekKey
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

        {/* 🕒 Voting Timer */}
        <div>
          <VotingTimerAdmin />
        </div>

        {/* 📝 Menu editor */}
        <div className="text-center">
          <a
            href="#menu-editor"
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById('menu-editor');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
            className="inline-block px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-md transition-all"
          >
            📋 Jump to Menu Editor
          </a>
        </div>
        <div id="menu-editor">
          <MenuAdmin />
        </div>

        {/* 👤 Admins */}
        <section className="bg-white p-6 rounded-xl shadow border border-gray-200">
          <h2 className="text-xl font-semibold mb-4 text-center">👤 Manage Admins</h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-6">
            <input
              type="email"
              value={newAdmin}
              onChange={(e) => setNewAdmin(e.target.value)}
              placeholder="Enter admin email"
              className="px-4 py-2 w-full sm:w-auto border border-gray-300 bg-white text-gray-900 rounded"
            />
            <button
              onClick={addAdmin}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
            >
              ➕ Add
            </button>
          </div>
          {loadingAdmins ? (
            <p className="text-center text-gray-500">Loading admins...</p>
          ) : (
            <ul className="space-y-2">
              {admins.map(({ email }) => (
                <li
                  key={email}
                  className="flex justify-between items-center px-4 py-2 bg-gray-100 rounded"
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

        {/* 🧨 Danger zone */}
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
