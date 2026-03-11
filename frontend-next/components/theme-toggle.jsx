'use client';

import { MoonStar, SunMedium } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('qa-theme') : null;
    const resolved = stored === 'light' ? 'light' : 'dark';
    setTheme(resolved);
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    window.localStorage.setItem('qa-theme', next);
  };

  return (
    <button type="button" className="qa-theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
      {theme === 'dark' ? <SunMedium size={16} /> : <MoonStar size={16} />}
      <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}
