import { useEffect, useReducer } from "react";
import type { Palette, Swatch } from "./types";
import { normalizeHex } from "./color";

const STORAGE_KEY = "kaleidoscope:palette";
const EXPORT_VERSION = 1;

export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 12;
export const MAX_ROW_SPAN = 6;

export type Action =
  | { type: "rename"; name: string }
  | { type: "setColumns"; columns: number }
  | { type: "add"; hexes: string[] }
  | { type: "addBlank"; id: string }
  | { type: "swap"; id: string; withId: string }
  | { type: "update"; id: string; patch: Partial<Omit<Swatch, "id">> }
  | { type: "remove"; id: string }
  | { type: "replace"; palette: Palette };

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

function makeSwatch(hex: string | null, id: string = crypto.randomUUID()): Swatch {
  return { id, hex, label: "", colSpan: 1, rowSpan: 1 };
}

const DEFAULT_PALETTE: Palette = {
  name: "Untitled palette",
  columns: 4,
  swatches: [],
};

function reducer(state: Palette, action: Action): Palette {
  switch (action.type) {
    case "rename":
      return { ...state, name: action.name };
    case "setColumns":
      return {
        ...state,
        columns: clamp(action.columns, MIN_COLUMNS, MAX_COLUMNS),
      };
    case "add":
      return {
        ...state,
        swatches: [...state.swatches, ...action.hexes.map((hex) => makeSwatch(hex))],
      };
    case "addBlank":
      return { ...state, swatches: [...state.swatches, makeSwatch(null, action.id)] };
    case "swap": {
      const a = state.swatches.findIndex((s) => s.id === action.id);
      const b = state.swatches.findIndex((s) => s.id === action.withId);
      if (a === -1 || b === -1 || a === b) return state;
      // Sizes stay with the slot, so the layout never shifts: only the two
      // colours (and their labels) trade places.
      const [first, second] = [state.swatches[a], state.swatches[b]];
      const swatches = [...state.swatches];
      swatches[a] = { ...second, colSpan: first.colSpan, rowSpan: first.rowSpan };
      swatches[b] = { ...first, colSpan: second.colSpan, rowSpan: second.rowSpan };
      return { ...state, swatches };
    }
    case "update":
      return {
        ...state,
        swatches: state.swatches.map((s) =>
          s.id === action.id ? { ...s, ...action.patch } : s,
        ),
      };
    case "remove":
      return {
        ...state,
        swatches: state.swatches.filter((s) => s.id !== action.id),
      };
    case "replace":
      return action.palette;
  }
}

/**
 * Turn untrusted data (from storage or an imported file) into a valid palette,
 * or null if it doesn't look like one. Bad swatches are dropped, numbers clamped.
 */
export function parsePalette(data: unknown): Palette | null {
  if (typeof data !== "object" || data === null) return null;
  const { name, columns, swatches } = data as Record<string, unknown>;
  if (!Array.isArray(swatches)) return null;
  const seenIds = new Set<string>();

  return {
    name: typeof name === "string" ? name : DEFAULT_PALETTE.name,
    columns: clamp(Number(columns) || 4, MIN_COLUMNS, MAX_COLUMNS),
    swatches: swatches.flatMap((s): Swatch[] => {
      if (typeof s !== "object" || s === null) return [];
      // null is a blank swatch still awaiting a hex code; anything else must parse.
      const hex = s.hex === null ? null : normalizeHex(String(s.hex ?? ""));
      if (hex === null && s.hex !== null) return [];
      const id =
        typeof s.id === "string" && !seenIds.has(s.id) ? s.id : crypto.randomUUID();
      seenIds.add(id);
      return [
        {
          id,
          hex,
          label: typeof s.label === "string" ? s.label : "",
          colSpan: clamp(Number(s.colSpan) || 1, 1, MAX_COLUMNS),
          rowSpan: clamp(Number(s.rowSpan) || 1, 1, MAX_ROW_SPAN),
        },
      ];
    }),
  };
}

/** The export file: the palette minus internal ids, plus a format version. */
export function serializePalette(palette: Palette): string {
  return JSON.stringify(
    {
      version: EXPORT_VERSION,
      name: palette.name,
      columns: palette.columns,
      swatches: palette.swatches.map(({ hex, label, colSpan, rowSpan }) => ({
        hex,
        label,
        colSpan,
        rowSpan,
      })),
    },
    null,
    2,
  );
}

function load(): Palette {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return (raw && parsePalette(JSON.parse(raw))) || DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

export function usePalette() {
  const [palette, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(palette));
    } catch {
      // Storage can be unavailable (private mode, quota); the app still works.
    }
  }, [palette]);

  return [palette, dispatch] as const;
}
