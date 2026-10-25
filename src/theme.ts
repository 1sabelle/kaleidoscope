import { useEffect, useState } from "react";
import { cssColorToHex, isLight } from "./color";

export type Theme = "system" | "light" | "dark";

/** Hand-picked colours laid over the theme; unset ones use the theme's own. */
export type CustomColours = {
  background?: string; // page, as "#rrggbb"
};

const THEME_KEY = "kaleidoscope:theme";
const COLOURS_KEY = "kaleidoscope:colours";

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function loadColours(): CustomColours {
  try {
    const saved = JSON.parse(localStorage.getItem(COLOURS_KEY) ?? "{}");
    const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/.test(v) ? v : undefined);
    return { background: hex(saved?.background) };
  } catch {
    return {};
  }
}

function save(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, quota); the choice just won't stick.
  }
}

/**
 * Applies the theme and custom colours to <html> (index.html does the same
 * before first paint, so there's no flash):
 * - `data-theme`: "light" or "dark", or absent to follow the OS
 * - `--bg`: a custom background, with `data-ink` saying whether text on it
 *   should be "dark" or "light"
 */
/** Which ink reads on a colour: "dark" text on a light one, "light" on a dark one. */
export function inkFor(hex: string): "dark" | "light" {
  return isLight(hex) ? "dark" : "light";
}

export function applyAppearance(theme: Theme, colours: CustomColours) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;

  if (colours.background) {
    root.style.setProperty("--bg", colours.background);
    root.dataset.ink = inkFor(colours.background);
  } else {
    root.style.removeProperty("--bg");
    delete root.dataset.ink;
  }
}

/** The background colour on screen of the first element matching `selector`, as hex. */
export function renderedColour(selector: string): string | null {
  const el = document.querySelector(selector);
  return el ? cssColorToHex(getComputedStyle(el).backgroundColor) : null;
}

/** Light, dark or follow the OS, plus optional custom background colours. */
export function useAppearance() {
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  const [colours, setColours] = useState<CustomColours>(loadColours);

  useEffect(() => {
    applyAppearance(theme, colours);
    save(THEME_KEY, theme === "system" ? null : theme);
    save(COLOURS_KEY, colours.background ? JSON.stringify(colours) : null);
  }, [theme, colours]);

  /** Picking a theme (even the current one) goes back to its own background. */
  function setTheme(next: Theme) {
    setThemeState(next);
    setColours({});
  }

  function setColour(key: keyof CustomColours, hex: string | null) {
    setColours((prev) => ({ ...prev, [key]: hex ?? undefined }));
  }

  return { theme, colours, setTheme, setColour };
}
