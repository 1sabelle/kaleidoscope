import { useEffect, useReducer } from "react";
import type { Group, GroupBox, LayoutNode, Palette, Swatch } from "./types";
import { normalizeHex } from "./color";
import {
  findGroup,
  groupsOf,
  insertBeside,
  mapGroups,
  normalize,
  removeGroup,
} from "./layout";
import type { Side } from "./layout";

const STORAGE_KEY = "kaleidoscope:palette";
const EXPORT_VERSION = 2;

export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 12;
export const MAX_ROW_SPAN = 6;
export const MIN_GROUP_WIDTH = 200; // px
export const MIN_GROUP_HEIGHT = 120; // px

const BOX_MINIMUMS: Required<GroupBox> = {
  width: MIN_GROUP_WIDTH,
  height: MIN_GROUP_HEIGHT,
  offsetX: 0,
  offsetY: 0,
};

/** A number for one part of a group's size, or undefined if it isn't one. */
function boxValue(key: keyof GroupBox, value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(BOX_MINIMUMS[key], Math.round(value));
}
const MAX_DEPTH = 32; // guards parsing against absurdly nested files

export type Action =
  | { type: "rename"; name: string }
  | { type: "addGroup"; id: string }
  | { type: "renameGroup"; groupId: string; name: string }
  | { type: "setColumns"; groupId: string; columns: number }
  | { type: "removeGroup"; groupId: string }
  | { type: "moveGroup"; groupId: string; targetId: string; side: Side }
  | { type: "mergeGroup"; groupId: string; intoId: string }
  | { type: "pinWidths"; widths: Record<string, number> }
  // null clears that part of the size, so it follows the layout again
  | { type: "resizeGroup"; groupId: string; box: { [K in keyof GroupBox]?: number | null } }
  | { type: "resetSizes" }
  | { type: "add"; groupId: string; hexes: string[] }
  | { type: "addBlank"; groupId: string; id: string }
  | { type: "swap"; id: string; withId: string }
  | { type: "moveSwatch"; id: string; groupId: string }
  | { type: "update"; id: string; patch: Partial<Omit<Swatch, "id">> }
  | { type: "remove"; id: string }
  | { type: "replace"; palette: Palette };

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

function makeSwatch(hex: string | null, id: string = crypto.randomUUID()): Swatch {
  return { id, hex, label: "", colSpan: 1, rowSpan: 1 };
}

function makeGroup(name: string, id: string = crypto.randomUUID()): Group {
  return { kind: "group", id, name, columns: 4, swatches: [] };
}

/** "Group 2", "Group 3", … skipping any name already taken. */
function nextGroupName(layout: LayoutNode): string {
  const taken = new Set(groupsOf(layout).map((g) => g.name));
  let n = groupsOf(layout).length + 1;
  while (taken.has(`Group ${n}`)) n++;
  return `Group ${n}`;
}

const DEFAULT_PALETTE: Palette = {
  name: "Untitled palette",
  layout: makeGroup("Group 1", "default"),
};

/** Apply `fn` to the swatch list of one group (or every group, if no id). */
function editSwatches(
  layout: LayoutNode,
  groupId: string | null,
  fn: (swatches: Swatch[]) => Swatch[],
): LayoutNode {
  return mapGroups(layout, (g) =>
    groupId === null || g.id === groupId ? { ...g, swatches: fn(g.swatches) } : g,
  );
}

function layoutReducer(layout: LayoutNode, action: Action): LayoutNode {
  switch (action.type) {
    case "addGroup": {
      // New groups go underneath everything else.
      const group = makeGroup(nextGroupName(layout), action.id);
      return layout.kind === "split" && layout.direction === "column"
        ? { ...layout, children: [...layout.children, group] }
        : { kind: "split", id: crypto.randomUUID(), direction: "column", children: [layout, group] };
    }
    case "renameGroup":
      return mapGroups(layout, (g) => (g.id === action.groupId ? { ...g, name: action.name } : g));
    case "setColumns":
      return mapGroups(layout, (g) =>
        g.id === action.groupId
          ? { ...g, columns: clamp(action.columns, MIN_COLUMNS, MAX_COLUMNS) }
          : g,
      );
    case "removeGroup":
      // There's always at least one group to add colours to.
      return removeGroup(layout, action.groupId) ?? layout;
    case "moveGroup": {
      const group = findGroup(layout, action.groupId);
      if (!group || action.groupId === action.targetId) return layout;
      const rest = removeGroup(layout, action.groupId);
      if (!rest) return layout;
      // Space it had in front of it belonged to its old spot.
      const moved = { ...group, offsetX: undefined, offsetY: undefined };
      return normalize(insertBeside(rest, action.targetId, moved, action.side)) ?? layout;
    }
    case "mergeGroup": {
      // The group dropped onto keeps its name, size and place; the dragged
      // group's colours are added after its own.
      const source = findGroup(layout, action.groupId);
      if (!source || action.groupId === action.intoId) return layout;
      const merged = editSwatches(layout, action.intoId, (swatches) => [
        ...swatches,
        ...source.swatches,
      ]);
      return removeGroup(merged, action.groupId) ?? layout;
    }
    case "pinWidths":
      return mapGroups(layout, (g) =>
        g.id in action.widths ? { ...g, width: boxValue("width", action.widths[g.id]) } : g,
      );
    case "resizeGroup":
      return mapGroups(layout, (g) => {
        if (g.id !== action.groupId) return g;
        const box = Object.fromEntries(
          Object.entries(action.box).map(([key, value]) => [
            key,
            boxValue(key as keyof GroupBox, value),
          ]),
        );
        return { ...g, ...box };
      });
    case "resetSizes":
      return mapGroups(layout, (g) => ({
        ...g,
        width: undefined,
        height: undefined,
        offsetX: undefined,
        offsetY: undefined,
      }));
    case "add":
      return editSwatches(layout, action.groupId, (swatches) => [
        ...swatches,
        ...action.hexes.map((hex) => makeSwatch(hex)),
      ]);
    case "addBlank":
      return editSwatches(layout, action.groupId, (swatches) => [
        ...swatches,
        makeSwatch(null, action.id),
      ]);
    case "swap": {
      const all = groupsOf(layout).flatMap((g) => g.swatches);
      const first = all.find((s) => s.id === action.id);
      const second = all.find((s) => s.id === action.withId);
      if (!first || !second || first === second) return layout;
      // Sizes stay with the slot, so the layout never shifts: only the two
      // colours (and their labels) trade places, even across groups.
      return editSwatches(layout, null, (swatches) =>
        swatches.map((s) => {
          if (s.id === first.id) return { ...second, colSpan: s.colSpan, rowSpan: s.rowSpan };
          if (s.id === second.id) return { ...first, colSpan: s.colSpan, rowSpan: s.rowSpan };
          return s;
        }),
      );
    }
    case "moveSwatch": {
      const swatch = groupsOf(layout)
        .flatMap((g) => g.swatches)
        .find((s) => s.id === action.id);
      if (!swatch) return layout;
      const without = editSwatches(layout, null, (swatches) =>
        swatches.filter((s) => s.id !== action.id),
      );
      return editSwatches(without, action.groupId, (swatches) => [...swatches, swatch]);
    }
    case "update":
      return editSwatches(layout, null, (swatches) =>
        swatches.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)),
      );
    case "remove":
      return editSwatches(layout, null, (swatches) =>
        swatches.filter((s) => s.id !== action.id),
      );
    case "rename":
    case "replace":
      return layout;
  }
}

function reducer(state: Palette, action: Action): Palette {
  if (action.type === "rename") return { ...state, name: action.name };
  if (action.type === "replace") return action.palette;
  const layout = layoutReducer(state.layout, action);
  return layout === state.layout ? state : { ...state, layout };
}

function parseSwatches(list: unknown[], seenIds: Set<string>): Swatch[] {
  return list.flatMap((s): Swatch[] => {
    if (typeof s !== "object" || s === null) return [];
    const { hex: rawHex, id: rawId, label, colSpan, rowSpan } = s as Record<string, unknown>;
    // null is a blank swatch still awaiting a hex code; anything else must parse.
    const hex = rawHex === null ? null : normalizeHex(String(rawHex ?? ""));
    if (hex === null && rawHex !== null) return [];
    return [
      {
        id: uniqueId(rawId, seenIds),
        hex,
        label: typeof label === "string" ? label : "",
        colSpan: clamp(Number(colSpan) || 1, 1, MAX_COLUMNS),
        rowSpan: clamp(Number(rowSpan) || 1, 1, MAX_ROW_SPAN),
      },
    ];
  });
}

function uniqueId(raw: unknown, seenIds: Set<string>): string {
  const id = typeof raw === "string" && !seenIds.has(raw) ? raw : crypto.randomUUID();
  seenIds.add(id);
  return id;
}

function parseNode(data: unknown, seenIds: Set<string>, depth = 0): LayoutNode | null {
  if (typeof data !== "object" || data === null || depth > MAX_DEPTH) return null;
  const node = data as Record<string, unknown>;

  if (Array.isArray(node.children)) {
    return {
      kind: "split",
      id: uniqueId(node.id, seenIds),
      direction: node.direction === "row" ? "row" : "column",
      children: node.children.flatMap((c) => parseNode(c, seenIds, depth + 1) ?? []),
    };
  }

  if (!Array.isArray(node.swatches)) return null;
  return {
    kind: "group",
    id: uniqueId(node.id, seenIds),
    name: typeof node.name === "string" ? node.name : "Untitled group",
    columns: clamp(Number(node.columns) || 4, MIN_COLUMNS, MAX_COLUMNS),
    swatches: parseSwatches(node.swatches, seenIds),
    width: boxValue("width", node.width),
    height: boxValue("height", node.height),
    offsetX: boxValue("offsetX", node.offsetX) || undefined,
    offsetY: boxValue("offsetY", node.offsetY) || undefined,
  };
}

/**
 * Turn untrusted data (from storage or an imported file) into a valid palette,
 * or null if it doesn't look like one. Bad swatches are dropped, numbers clamped.
 * Version 1 files (one grid, no groups) become a palette with a single group.
 */
export function parsePalette(data: unknown): Palette | null {
  if (typeof data !== "object" || data === null) return null;
  const { name, columns, swatches, layout } = data as Record<string, unknown>;
  const seenIds = new Set<string>();

  const parsed =
    layout === undefined && Array.isArray(swatches)
      ? parseNode({ name: "Group 1", columns, swatches }, seenIds)
      : parseNode(layout, seenIds);
  const tidy = parsed && normalize(parsed);
  if (!tidy) return null;

  return {
    name: typeof name === "string" ? name : DEFAULT_PALETTE.name,
    layout: tidy,
  };
}

function exportNode(node: LayoutNode): unknown {
  if (node.kind === "split") {
    return {
      kind: "split",
      direction: node.direction,
      children: node.children.map(exportNode),
    };
  }
  return {
    kind: "group",
    name: node.name,
    columns: node.columns,
    width: node.width,
    height: node.height,
    offsetX: node.offsetX,
    offsetY: node.offsetY,
    swatches: node.swatches.map(({ hex, label, colSpan, rowSpan }) => ({
      hex,
      label,
      colSpan,
      rowSpan,
    })),
  };
}

/** The export file: the palette minus internal ids, plus a format version. */
export function serializePalette(palette: Palette): string {
  return JSON.stringify(
    { version: EXPORT_VERSION, name: palette.name, layout: exportNode(palette.layout) },
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
