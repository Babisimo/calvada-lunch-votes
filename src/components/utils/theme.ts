/**
 * Theme is OPT-IN, not OS-driven.
 *
 * The kraft ticket is the identity of the app, so everyone gets it by default —
 * including people whose operating system is set to dark. Night shift is a
 * choice made in the header and remembered per browser.
 *
 * The token overrides live under `:root[data-theme="dark"]` in src/index.css.
 * The attribute is written here and, to avoid a flash of the wrong theme before
 * React mounts, also by a small inline script in index.html. Keep the storage
 * key and the accepted values in sync between the two.
 */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'calvada-lunch-theme';

/** Kraft. Also what you get with no stored choice, or with JS disabled. */
const DEFAULT_THEME: Theme = 'light';

/** The browser UI color for each theme — matches --color-canvas. */
const THEME_COLOR: Record<Theme, string> = {
  light: '#e8e0d4',
  dark: '#17130f',
};

/**
 * localStorage throws outright in some contexts (Safari private mode, embedded
 * webviews, blocked site data), so every access is guarded. A browser that
 * can't remember the choice still gets a working toggle for the session.
 */
export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Paint the theme. Safe to call before React has mounted. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
}

/** Paint it and remember it. */
export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Session-only is an acceptable outcome; the toggle still works.
  }
}
