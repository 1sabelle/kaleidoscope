export type Swatch = {
  id: string;
  hex: string | null; // normalised "#rrggbb" (lowercase), or null while awaiting input
  label: string;
  colSpan: number; // width in grid cells
  rowSpan: number; // height in grid cells
};

/**
 * A group's hand-picked size, in px. Unset parts follow the layout: width
 * shares the row, height fits the grid, offsets are 0.
 */
export type GroupBox = {
  width?: number;
  height?: number; // grid rows stretch to fill it
  offsetX?: number; // space before the group, left by dragging its left edge in
  offsetY?: number; // likewise for the top edge
};

/** A named set of swatches with its own grid. */
export type Group = GroupBox & {
  kind: "group";
  id: string;
  name: string;
  columns: number; // grid width; rows grow automatically
  swatches: Swatch[];
  fill?: string; // box colour as "#rrggbb"; the theme's shading if unset
};

/** Lays its children out side by side ("row") or stacked ("column"). */
export type Split = {
  kind: "split";
  id: string;
  direction: "row" | "column";
  children: LayoutNode[];
};

export type LayoutNode = Group | Split;

export type Palette = {
  name: string;
  layout: LayoutNode;
};
