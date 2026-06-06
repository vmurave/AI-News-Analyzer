import { useEffect, useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Settings from './pages/Settings.jsx';
import Ornament from './components/Ornament.jsx';

// Theme is stored as data-theme="dark|light" on <html> (set pre-paint in
// index.html). We read the current value, toggle it, and persist to localStorage.
function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') || 'light'
  );
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

function SunIcon(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M3 12h1M20 12h1M12 3v1M12 20v1M5.6 5.6l.7.7M17.7 17.7l.7.7M18.4 5.6l-.7.7M6.3 17.7l-.7.7" />
    </svg>
  );
}

function MoonIcon(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z" />
    </svg>
  );
}

function Navbar() {
  const [theme, toggle] = useTheme();

  const navStyle = ({ isActive }) =>
    isActive
      ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
      : { color: 'var(--text-secondary)' };

  return (
    <header
      className="sticky top-0 z-10 backdrop-blur"
      style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            AI News Analyzer
          </h1>
        </div>
        <nav className="flex items-center gap-1">
          <NavLink
            to="/"
            end
            className="rounded-md px-3 py-2 text-sm font-medium transition-colors"
            style={navStyle}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/settings"
            className="rounded-md px-3 py-2 text-sm font-medium transition-colors"
            style={navStyle}
          >
            Set up subscription
          </NavLink>
          <button
            onClick={toggle}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="ml-2 flex items-center justify-center rounded-md p-2 transition-colors"
            style={{
              border: '1px solid var(--border-strong)',
              color: 'var(--text-secondary)',
              backgroundColor: 'transparent',
            }}
          >
            {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
          </button>
        </nav>
      </div>
      <Ornament />
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-full">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
