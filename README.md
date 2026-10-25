# Kaleidoscope

A simple palette builder. Paste hex codes, label colours, and arrange them in resizable grids, organised into named groups. Drag a group by its grip to place it beside, above or below another group, or drop it onto one to merge them. Resize a group from any edge or corner; double-click a handle (or press Fit to screen) to go back to automatic sizing. Every palette is saved in the browser; click the title to switch between them or start a new one.

```sh
npm install
npm run dev     # http://localhost:5173
npm run build   # static site in dist/
```

- `src/App.tsx` — toolbar (add group, theme, import/export), paste-anywhere, rendering the group layout, and drag-and-drop wiring (dnd-kit)
- `src/components/PaletteSwitcher.tsx` — the palette title and its menu of saved palettes (open, new, rename, delete)
- `src/components/ColourSetting.tsx` — the round colour swatch + picker used for group colours and the page background
- `src/components/GroupPanel.tsx` — one named group: header (grip, name, column count, delete) and its grid of swatches
- `src/components/SwatchTile.tsx` — one colour (or a blank awaiting a hex code): label, hex, picker, copy, remove, randomise, drag-to-move, drag-to-resize
- `src/palette.ts` — palette state (reducer), the library of saved palettes, import/export (older single-grid files load as one group), and localStorage autosave
- `src/theme.ts` — light/dark/auto theme and the custom page background
- `src/layout.ts` — the group layout tree (groups nested in rows and columns): move, merge, remove, tidy
- `src/color.ts` — hex parsing, contrast-aware text colour, random colours
