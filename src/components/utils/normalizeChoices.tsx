import { normalizeKey } from './normalizeKey';

// Ensures Firestore 'choices' yields a clean, de-duped string[] (keeps first-cased display)
export function normalizeChoices(raw: any): string[] {
  let arr: any[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === 'object') arr = Object.values(raw);

  const seen = new Set<string>();
  const out: string[] = [];

  for (const v of arr) {
    if (typeof v !== 'string') continue;
    const display = v.trim().replace(/\s+/g, ' ');
    if (!display) continue;
    const key = normalizeKey(display);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(display); // preserve display casing
  }
  return out;
}
