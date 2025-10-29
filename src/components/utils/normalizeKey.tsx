// Stable key for matching choices across votes/menu/weeklyOptions
export function normalizeKey(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}
