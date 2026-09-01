import { useEffect, useState } from 'react';
import {
  collection, addDoc, deleteDoc, doc, setDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import toast from 'react-hot-toast';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useWeekKey } from './utils/useWeekKey';
import { normalizeChoices } from './utils/normalizeChoices';
import { subscribeWeeklyOptions } from './utils/subscribeWeeklyOptions';
import { useConfirm } from './ui/ConfirmDialog';
import { btn, btnSize, cn, field, panel, sectionTitle } from './ui/styles';

export default function MenuAdmin() {
  const [menuItems, setMenuItems] = useState<{ id: string; name: string }[]>([]);
  const [weeklyOptions, setWeeklyOptions] = useState<string[]>([]);
  const [newItem, setNewItem] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const menuRef = collection(db, 'menu');
  const weekKey = useWeekKey();
  const { confirm, confirmDialog } = useConfirm();

  // Menu list
  useEffect(() => {
    const unsubMenu = onSnapshot(menuRef, (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, name: d.data().name }));
      setMenuItems(items);
      setLoading(false);
    });
    return () => unsubMenu();
  }, []);

  // Direct weeklyOptions listener
  useEffect(() => {
    if (!weekKey) { setWeeklyOptions([]); return; }
    return subscribeWeeklyOptions(weekKey, (docSnap) => {
      if (!docSnap) { setWeeklyOptions([]); return; }
      setWeeklyOptions(normalizeChoices(docSnap.choices));
    });
  }, [weekKey]);

  const handleAdd = async () => {
    if (!newItem.trim()) return;
    try {
      await addDoc(menuRef, { name: newItem.trim() });
      toast.success('Item added');
      setNewItem('');
    } catch (err) {
      toast.error("Couldn't add that item");
      console.error(err);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Delete ${name}?`,
      body: 'It comes off the menu for good. Past results keep the name.',
      confirmLabel: 'Delete item',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'menu', id));
      toast.success('Item deleted');
    } catch (err) {
      toast.error("Couldn't delete that item");
      console.error(err);
    }
  };

  const handleEditSave = async (id: string) => {
    if (!editText.trim()) return;
    try {
      await setDoc(doc(db, 'menu', id), { name: editText.trim() }, { merge: true });
      toast.success('Item updated');
      setEditingId(null);
    } catch (err) {
      toast.error("Couldn't update that item");
      console.error(err);
    }
  };

  const handleAddToWeekly = async (name: string) => {
    if (!weekKey) { toast.error('Set the current week first'); return; }
    if (weeklyOptions.includes(name)) { toast('Already on this week\'s ballot'); return; }

    const updated = [...weeklyOptions, name];
    await setDoc(doc(db, 'weeklyOptions', weekKey), {
      week: weekKey,
      choices: updated,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    toast.success(`${name} added to the ballot`);
  };

  return (
    <section className={cn(panel, 'p-5 sm:p-6')}>
      {confirmDialog}

      <h2 className={cn(sectionTitle, 'mb-1')}>Menu</h2>
      <p className="mb-4 text-sm text-ink-subtle">
        Everything the weekly draw can pull from. Items on this week&apos;s ballot are marked.
      </p>

      {/* Add item */}
      <div className="mb-5 flex flex-col gap-2.5 sm:flex-row">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="e.g. 🍔 Burgers"
          aria-label="New menu item"
          className={field}
        />
        <button onClick={handleAdd} className={cn(btn.primary, btnSize.md, 'shrink-0')}>
          <Plus size={16} strokeWidth={2.25} aria-hidden="true" />
          Add item
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-card bg-surface-muted" />
          ))}
        </div>
      ) : menuItems.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong px-4 py-6 text-center text-sm text-ink-subtle">
          <span aria-hidden="true" className="mr-1.5">🍽️</span>
          No menu items yet. Add the first one above.
        </p>
      ) : (
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const isSelected = weeklyOptions.includes(item.name);
            return (
              <li
                key={item.id}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-card border px-4 py-2.5',
                  isSelected ? 'border-brand-200 bg-brand-50' : 'border-border bg-surface-muted'
                )}
              >
                {editingId === item.id ? (
                  <>
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleEditSave(item.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      aria-label={`Rename ${item.name}`}
                      autoFocus
                      className={cn(field, 'py-1.5')}
                    />
                    <div className="flex shrink-0 items-center gap-1">
                      <button onClick={() => handleEditSave(item.id)} className={btn.quiet}>
                        <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                        Save
                      </button>
                      <button onClick={() => setEditingId(null)} className={btn.quiet}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{item.name}</span>
                      {isSelected && (
                        <span className="ticket-control inline-flex shrink-0 items-center gap-1 bg-stamp-600 px-2 py-0.5 text-[0.5625rem] text-on-stamp">
                          <Check size={11} strokeWidth={3} aria-hidden="true" />
                          On ballot
                        </span>
                      )}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {!isSelected && (
                        <button onClick={() => handleAddToWeekly(item.name)} className={btn.quiet}>
                          <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
                          Add to ballot
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingId(item.id); setEditText(item.name); }}
                        className={btn.quiet}
                        aria-label={`Rename ${item.name}`}
                      >
                        <Pencil size={14} strokeWidth={2.5} aria-hidden="true" />
                        Rename
                      </button>
                      <button
                        onClick={() => handleDelete(item.id, item.name)}
                        className={btn.quietDanger}
                        aria-label={`Delete ${item.name}`}
                      >
                        <Trash2 size={14} strokeWidth={2.5} aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
