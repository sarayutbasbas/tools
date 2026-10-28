import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const key = 'toolbox-theme';
const savedTheme = (): Theme | null => {
  try { const value = localStorage.getItem(key); return value === 'light' || value === 'dark' ? value : null; }
  catch { return null; }
};

export function useTheme() {
  const [preference, setPreference] = useState<Theme | null>(savedTheme);
  const [theme, setTheme] = useState<Theme>(() => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const next = preference || (media.matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = next;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#171c19' : '#f4f4f0');
      setTheme(next);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preference]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) setPreference(savedTheme()); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setPreference(next);
    try { localStorage.setItem(key, next); } catch { /* Theme still works when storage is unavailable. */ }
  };
  return { theme, toggleTheme };
}
