export type Swatch = {
  id: string;
  hex: string | null; // normalised "#rrggbb" (lowercase), or null while awaiting input
  label: string;
  colSpan: number; // width in grid cells
  rowSpan: number; // height in grid cells
};

export type Palette = {
  name: string;
  columns: number; // grid width; rows grow automatically
  swatches: Swatch[];
};
