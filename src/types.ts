export type Swatch = {
  id: string;
  hex: string | null; // normalised "#rrggbb" (lowercase), or null while awaiting input
  label: string;
  colSpan: number; // width in grid cells
  rowSpan: number; // height in grid cells
};

/** A named set of swatches with its own grid. */
export type Group = {
  kind: "group";
  id: string;
  name: string;
  columns: number; // grid width; rows grow automatically
  swatches: Swatch[];
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
