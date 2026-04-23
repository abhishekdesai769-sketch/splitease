import { createContext, useContext, useEffect, useState } from "react";
import { apiRequest } from "./queryClient";

export type ThemePref = "dark" | "light" | "system";
export type Theme = "dark" | "light"; // resolved (actual class applied)

const STORAGE_KEY = "spliiit_theme";

function getSystemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

function resolveTheme(pref: ThemePref): Theme {
  if (pref === "system") return getSystemTheme();
  return pref;
}

function loadStoredPref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light" || stored === "system") return stored;
  } catch {}
  return "system"; // default: follow device
}

const ThemeContext = createContext<{
  theme: Theme;           // resolved: "dark" | "light"
  themePref: ThemePref;  // raw preference: "dark" | "light" | "system"
  setThemePref: (pref: ThemePref, saveToDb?: boolean) => void;
  toggleTheme: () => void;
  syncFromDb: (dbPref: string) => void; // called by auth after login to sync cross-device
}>({
  theme: "dark",
  themePref: "system",
  setThemePref: () => {},
  toggleTheme: () => {},
  syncFromDb: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themePref, setThemePrefState] = useState<ThemePref>(loadStoredPref);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(loadStoredPref()));

  // Apply resolved theme to <html> whenever preference changes
  useEffect(() => {
    const resolved = resolveTheme(themePref);
    setTheme(resolved);
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [themePref]);

  // When preference is "system", listen for OS dark mode changes in real time
  useEffect(() => {
    if (themePref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const resolved = getSystemTheme();
      setTheme(resolved);
      document.documentElement.classList.toggle("dark", resolved === "dark");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [themePref]);

  /** Set theme preference, persist to localStorage, optionally save to DB. */
  const setThemePref = (pref: ThemePref, saveToDb = true) => {
    setThemePrefState(pref);
    try { localStorage.setItem(STORAGE_KEY, pref); } catch {}
    if (saveToDb) {
      apiRequest("PATCH", "/api/user/preferences", { themePreference: pref }).catch(() => {});
    }
  };

  /** Called by auth context after login to sync DB preference cross-device.
   *  Applies DB value to localStorage without triggering another DB write. */
  const syncFromDb = (dbPref: string) => {
    if (dbPref === "dark" || dbPref === "light" || dbPref === "system") {
      setThemePref(dbPref, false); // apply locally only
    }
  };

  /** Quick header toggle: dark ↔ light (system → resolves to current, then flips). */
  const toggleTheme = () => {
    const next: ThemePref = theme === "dark" ? "light" : "dark";
    setThemePref(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, themePref, setThemePref, toggleTheme, syncFromDb }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
