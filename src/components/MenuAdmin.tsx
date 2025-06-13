import { useEffect, useState } from 'react';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  setDoc,
  getDoc,
  onSnapshot
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

function formatCountdown(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export default function MenuAdmin() {
  const [menuItems, setMenuItems] = useState<{ id: string; name: string }[]>([]);
  const [weeklyOptions, setWeeklyOptions] = useState<string[]>([]);
  const [newItem, setNewItem] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [countdown, setCountdown] = useState('');
  const [status, setStatus] = useState<'before' | 'during' | 'after'>('before');

  const menuRef = collection(db, 'menu');
  const weekKey = getWeekKey();

  useEffect(() => {
    const unsubMenu = onSnapshot(menuRef, (snapshot) => {
      const items = snapshot.docs.map((doc) => ({ id: doc.id, name: doc.data().name }));
      setMenuItems(items);
      setLoading(false);
    });

    const unsubWeekly = onSnapshot(doc(db, 'weeklyOptions', weekKey), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setWeeklyOptions(data.choices || []);
      } else {
        setWeeklyOptions([]);
      }
    });

    return () => {
      unsubMenu();
      unsubWeekly();
    };
  }, [weekKey]);

  useEffect(() => {
    const fetchVotingConfig = async () => {
      const configSnap = await getDoc(doc(db, 'settings', 'votingConfig'));
      if (configSnap.exists()) {
        const data = configSnap.data();
        if (data.startTime?.seconds) setStartTime(new Date(data.startTime.seconds * 1000).toISOString().slice(0, 16));
        if (data.endTime?.seconds) setEndTime(new Date(data.endTime.seconds * 1000).toISOString().slice(0, 16));
      }
    };
    fetchVotingConfig();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!startTime || !endTime) return;

      const now = new Date().getTime();
      const start = new Date(startTime).getTime();
      const end = new Date(endTime).getTime();

      if (now < start) {
        setStatus('before');
        setCountdown(formatCountdown(start - now));
      } else if (now < end) {
        setStatus('during');
        setCountdown(formatCountdown(end - now));
      } else {
        setStatus('after');
        setCountdown('Voting period has ended');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime, endTime]);

  const saveVotingTimes = async () => {
    if (!startTime || !endTime) {
      toast.error('Please select both start and end times!');
      return;
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (end <= start) {
      toast.error('End time must be after start time');
      return;
    }

    await setDoc(doc(db, 'settings', 'votingConfig'), {
      startTime: start,
      endTime: end
    });

    toast.success('🕒 Voting timer saved!');
  };

  const handleAdd = async () => {
    if (!newItem.trim()) return;
    try {
      await addDoc(menuRef, { name: newItem.trim() });
      toast.success('Item added!');
      setNewItem('');
    } catch (err) {
      toast.error('Failed to add item');
      console.error(err);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const confirmDelete = confirm(`Are you sure you want to delete "${name}" from the menu?`);
    if (!confirmDelete) return;

    try {
      await deleteDoc(doc(db, 'menu', id));
      toast.success('Item deleted!');
    } catch (err) {
      toast.error('Failed to delete item');
      console.error(err);
    }
  };

  const handleEditSave = async (id: string) => {
    try {
      await setDoc(doc(db, 'menu', id), { name: editText.trim() });
      toast.success('Item updated!');
      setEditingId(null);
    } catch (err) {
      toast.error('Failed to update item');
      console.error(err);
    }
  };

  const handleAddToWeekly = async (name: string) => {
    if (weeklyOptions.includes(name)) {
      toast('Already in weekly options!');
      return;
    }

    const updated = [...weeklyOptions, name];
    await setDoc(doc(db, 'weeklyOptions', weekKey), {
      week: weekKey,
      choices: updated
    });
    toast.success(`✅ "${name}" added to weekly options`);
  };

  return (
    <div className="mt-12 p-6 bg-white rounded-xl shadow-md border border-gray-200 text-center max-w-2xl mx-auto">
      <Toaster position="top-center" />
      <h2 className="text-2xl font-semibold mb-6">🛠️ Edit Menu Options</h2>

      {/* Add Item */}
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

      {/* List Items */}
      {loading ? (
        <p className="text-gray-400">Loading menu...</p>
      ) : (
        <ul className="space-y-3 max-w-md mx-auto text-left">
          {menuItems.map((item) => {
            const isSelected = weeklyOptions.includes(item.name);
            return (
              <li
                key={item.id}
                className={`flex justify-between items-center px-4 py-2 rounded-md shadow-sm border ${isSelected ? 'border-green-500 bg-green-50' : 'bg-gray-50'
                  }`}
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
                    <span className="text-base text-gray-800">
                      {item.name}
                      {isSelected && <span className="ml-1 text-green-600">✔️</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      {!isSelected && (
                        <button
                          onClick={() => handleAddToWeekly(item.name)}
                          className="text-blue-600 hover:underline text-sm"
                        >
                          ➕ Add
                        </button>
                      )}
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
                        onClick={() => handleDelete(item.id, item.name)}
                        className="text-red-500 hover:underline text-sm"
                      >
                        ❌ Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
