// Ensures Firestore 'choices' yields a clean string[]
export function normalizeChoices(raw: any): string[] {
  try {
    if (Array.isArray(raw)) {
      return raw
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v) => v.length > 0);
    }
    if (raw && typeof raw === 'object') {
      return Object.values(raw)
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v) => v.length > 0);
    }
  } catch {
    // ignore
  }
  return [];
}
