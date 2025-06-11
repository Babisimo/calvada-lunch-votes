import { useEffect, useState } from 'react';
import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  setDoc,
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

export default function MenuAdmin() {
  const [menuItems, setMenuItems] = useState<{ id: string; name: string }[]>([]);
  const [weeklyOptions, setWeeklyOptions] = useState<string[]>([]);
  const [newItem, setNewItem] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

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

  const handleAdd = async () => {
    if (!newItem.trim()) return;
    try {
      const docRef = await addDoc(menuRef, { name: newItem.trim() });
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
