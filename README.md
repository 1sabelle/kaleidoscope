# Kaleidoscope

A simple palette builder. Paste hex codes, label colours, and arrange them in a resizable grid.

```sh
npm install
npm run dev     # http://localhost:5173
npm run build   # static site in dist/
```

- `src/App.tsx` — toolbar (name, column count, import/export), paste-anywhere, the grid, and drag-and-drop wiring (dnd-kit)
- `src/components/SwatchTile.tsx` — one colour (or a blank awaiting a hex code): label, hex, picker, copy, remove, randomise, drag-to-move, drag-to-resize
- `src/palette.ts` — palette state (reducer) and localStorage autosave
- `src/color.ts` — hex parsing, contrast-aware text colour, random colours
