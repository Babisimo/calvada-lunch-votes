import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { btn, cn } from './styles';
import { getStoredTheme, setTheme, type Theme } from '../utils/theme';

/**
 * Light is the default for everyone; this is the opt-in to night shift.
 *
 * The icon shows the theme you would SWITCH TO, which is the convention people
 * already read, and the accessible name says it out loud rather than leaving
 * the icon to carry the meaning alone.
 *
 * Lives in both the voter header (App.tsx) and the admin header
 * (AdminDashboard.tsx). The two instances don't share React state — they never
 * appear on the same screen, and each initialises from storage, which the
 * inline script in index.html has already applied by the time either mounts.
 */
export default function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  }

  const goingDark = theme === 'light';
  const labelText = goingDark ? 'Switch to dark' : 'Switch to light';

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(btn.quiet, 'px-2 py-1.5')}
      aria-label={labelText}
      title={labelText}
    >
      {goingDark ? (
        <Moon size={15} strokeWidth={2.25} aria-hidden="true" />
      ) : (
        <Sun size={15} strokeWidth={2.25} aria-hidden="true" />
      )}
    </button>
  );
}
