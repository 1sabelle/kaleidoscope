import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "kaleidoscope:theme";

function load(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

/**
 * Light, dark, or follow the OS. The choice is set as `data-theme` on <html>
 * (index.html does the same before first paint, so there's no flash).
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(load);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable (private mode, quota); the choice just won't stick.
    }
  }, [theme]);

  return [theme, setTheme] as const;
}
