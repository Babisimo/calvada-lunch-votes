// Ensures Firestore 'choices' yields a clean, de-duped string[]
export function normalizeChoices(raw: any): string[] {
  let arr: any[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === 'object') arr = Object.values(raw);

  const seen = new Set<string>();
  const out: string[] = [];

  for (const v of arr) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
