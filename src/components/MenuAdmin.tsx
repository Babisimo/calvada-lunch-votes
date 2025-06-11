import { useEffect, useState } from 'react';
import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  setDoc,
  onSnapshot,
  query,
  where
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import toast, { Toaster } from 'react-hot-toast';

const getWeekKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const week = Math.ceil(
    ((+now - new Date(year, 0, 1).getTime()) / 86400000 + new Date(year, 0, 1).getDay() + 1) / 7
  );
  return `${year}-W${week}`;
};

export default function MenuAdmin() {
  const [menuItems, setMenuItems] = useState<{ id: string; name: string }[]>([]);
  const [newItem, setNewItem] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasVotes, setHasVotes] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const menuRef = collection(db, 'menu');
  const weekKey = getWeekKey();

  useEffect(() => {
    const unsub = onSnapshot(menuRef, (snapshot) => {
      const items = snapshot.docs.map((doc) => ({ id: doc.id, name: doc.data().name }));
      setMenuItems(items);
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const votesQuery = query(collection(db, 'votes'), where('week', '==', weekKey));
    const unsubVotes = onSnapshot(votesQuery, snap => {
      setHasVotes(snap.size > 0);
    });
    return () => unsubVotes();
  }, [weekKey]);

  async function handleAdd() {
    if (!newItem.trim()) return;
    try {
      const docRef = await addDoc(menuRef, { name: newItem.trim() });
      setMenuItems(prev => [...prev, { id: docRef.id, name: newItem.trim() }]);
      toast.success('Item added!');
      setNewItem('');
    } catch (err) {
      toast.error('Failed to add item');
      console.error(err);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDoc(doc(db, 'menu', id));
      setMenuItems(prev => prev.filter((item) => item.id !== id));
      toast.success('Item deleted!');
    } catch (err) {
      toast.error('Failed to delete');
      console.error(err);
    }
  }

  async function regenerateWeeklyOptions() {
    try {
      const snapshot = await getDocs(menuRef);
      const allOptions = snapshot.docs.map((doc) => doc.data().name);
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
      toast.error('Failed to regenerate');
      console.error(err);
    }
  }

  async function handleEditSave(id: string) {
    try {
      await setDoc(doc(db, 'menu', id), { name: editText.trim() });
      toast.success('Item updated!');
      setEditingId(null);
    } catch (err) {
      toast.error('Failed to update');
      console.error(err);
    }
  }

  return (
    <div className="mt-12 p-6 bg-white rounded-xl shadow-md border border-gray-200 text-center max-w-2xl mx-auto">
      <Toaster position="top-center" />
      <h2 className="text-2xl font-semibold mb-6">🛠️ Edit Menu Options</h2>

      <div className="flex flex-col sm:flex-row gap-3 items-center justify-center mb-6">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="e.g. 🍔 Burgers"
          className="flex-1 px-4 py-2 rounded-md border border-gray-300 bg-white text-gray-900"
        />
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition"
        >
          ➕ Add
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading menu...</p>
      ) : (
        <ul className="space-y-3 max-w-md mx-auto text-left">
          {menuItems.map((item) => (
            <li
              key={item.id}
              className="flex justify-between items-center px-4 py-2 bg-gray-50 rounded-md shadow-sm"
            >
              {editingId === item.id ? (
                <>
                  <input
                    type="text"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleEditSave(item.id);
                    }}
                    className="flex-1 mr-2 px-2 py-1 rounded border border-gray-300 bg-white text-gray-900"
                  />
                  <button
                    onClick={() => handleEditSave(item.id)}
                    className="text-green-600 hover:text-green-700 text-sm font-medium"
                  >
                    ✅ Save
                  </button>
                </>
              ) : (
                <>
                  <span className="text-base text-gray-800">{item.name}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingId(item.id);
                        setEditText(item.name);
                      }}
                      className="text-yellow-500 hover:underline text-sm"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-red-500 hover:underline text-sm"
                    >
                      ❌ Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <button
          onClick={regenerateWeeklyOptions}
          disabled={hasVotes}
          className={`w-full py-3 text-white rounded-lg font-semibold shadow transition-all ${
            hasVotes
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:shadow-md'
          }`}
        >
          🔄 Regenerate This Week's Options
        </button>
        {hasVotes && (
          <p className="text-sm text-red-500 mt-2">
            Cannot regenerate after voting has started.
          </p>
        )}
      </div>
    </div>
  );
}
