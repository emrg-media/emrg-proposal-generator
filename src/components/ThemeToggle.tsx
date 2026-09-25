"use client";

import { useEffect, useSyncExternalStore } from "react";

// Light or dark, remembered per browser.
//
// The stored choice is read through useSyncExternalStore rather than an effect
// that sets state: it gives the server an explicit snapshot, so there is no
// hydration mismatch and no cascading render. The only effect here writes to
// the DOM, which is what effects are for.
//
// A script in the layout applies the same value before first paint so the page
// does not flash light. React reconciles <html> during hydration and can drop
// that attribute, so this component re-applies it; without that the theme reset
// on every navigation.

type Theme = "light" | "dark";

const KEY = "emrg_theme";
const listeners = new Set<() => void>();

function readStored(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light"; // private mode, or storage disabled
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // Another tab changing the theme should update this one too.
  window.addEventListener("storage", fn);
  return () => { listeners.delete(fn); window.removeEventListener("storage", fn); };
}

function setStored(theme: Theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readStored, () => "light" as Theme);

  useEffect(() => {
    if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }, [theme]);

  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setStored(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="inline-flex items-center justify-center w-[28px] h-[28px] rounded-md transition-opacity hover:opacity-100 flex-shrink-0"
      style={{ color: "var(--header-muted)" }}
    >
      {theme === "dark" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
