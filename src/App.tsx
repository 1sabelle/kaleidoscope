import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { flushSync } from "react-dom";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  CollisionDetection,
  DragEndEvent,
  DragStartEvent,
  KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SwatchTile } from "./components/SwatchTile";
import type { CellSize } from "./components/SwatchTile";
import {
  MAX_COLUMNS,
  MIN_COLUMNS,
  parsePalette,
  serializePalette,
  usePalette,
} from "./palette";
import { parseHexList, textColorFor } from "./color";

// Tiles have different sizes, so "what's under the pointer" beats "nearest centre".
// Keyboard drags have no pointer, so they fall back to the nearest tile.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

// Tiles stay put while dragging (the target is highlighted instead), because
// shuffling differently-sized tiles mid-drag makes the grid jump around.
const noShuffle = () => null;

const ARROWS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

// Arrow keys jump the held tile onto the nearest tile in that direction.
const keyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { active, context: { collisionRect, droppableRects, droppableContainers } },
) => {
  const dir = ARROWS[event.code];
  if (!dir || !collisionRect) return undefined;
  event.preventDefault();

  const cx = collisionRect.left + collisionRect.width / 2;
  const cy = collisionRect.top + collisionRect.height / 2;
  let target: { x: number; y: number } | undefined;
  let bestScore = Infinity;

  for (const container of droppableContainers.getEnabled()) {
    const rect = droppableRects.get(container.id);
    if (container.id === active || !rect) continue;
    const dx = rect.left + rect.width / 2 - cx;
    const dy = rect.top + rect.height / 2 - cy;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 1) continue; // behind us or level with us
    const across = Math.abs(dx * dir[1] + dy * dir[0]);
    const score = along + across * 2; // prefer tiles straight ahead
    if (score < bestScore) {
      bestScore = score;
      target = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  }

  // Coordinates are the held tile's top-left; centre it on the target.
  return target && {
    x: target.x - collisionRect.width / 2,
    y: target.y - collisionRect.height / 2,
  };
};

export default function App() {
  const [palette, dispatch] = usePalette();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const { columns } = palette;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );

  const getCellSize = useCallback((): CellSize => {
    const grid = gridRef.current;
    if (!grid) return { width: 160, height: 160, gap: 12 };
    const styles = getComputedStyle(grid);
    const gap = parseFloat(styles.columnGap) || 0;
    return {
      width: (grid.clientWidth - gap * (columns - 1)) / columns,
      height: parseFloat(styles.gridAutoRows) || 160,
      gap,
    };
  }, [columns]);

  function addBlank() {
    const id = crypto.randomUUID();
    dispatch({ type: "addBlank", id });
    setFocusId(id);
  }

  // Pasting hex codes anywhere on the page (while not typing in a field) adds
  // them as new colours, e.g. "264653, 2a9d8f" or a coolors.co link.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const hexes = parseHexList(e.clipboardData?.getData("text") ?? "");
      if (hexes.length === 0) return;
      e.preventDefault();
      dispatch({ type: "add", hexes });
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [dispatch]);

  function exportPalette() {
    const blob = new Blob([serializePalette(palette)], { type: "application/json" });
    const slug = palette.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${slug || "palette"}.json`;
    link.click();
    // Revoking straight away can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function importPalette(file: File) {
    setImportError(null);
    let imported;
    try {
      imported = parsePalette(JSON.parse(await file.text()));
    } catch {
      imported = null;
    }
    if (!imported) {
      setImportError(`“${file.name}” isn’t a palette file this app can read.`);
      return;
    }
    const replacing = palette.swatches.length > 0;
    if (replacing && !confirm(`Replace “${palette.name}” with “${imported.name}”?`)) return;
    dispatch({ type: "replace", palette: imported });
  }

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over || over.id === active.id) return;
    // Dropping onto a tile swaps the two; everything else stays where it is.
    const swap = () =>
      flushSync(() =>
        dispatch({ type: "swap", id: String(active.id), withId: String(over.id) }),
      );
    // Animate tiles sliding into their new spots where the browser supports it.
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (document.startViewTransition && !reduceMotion) document.startViewTransition(swap);
    else swap();
  }

  const activeSwatch = palette.swatches.find((s) => s.id === activeId);

  return (
    <div className="app">
      <header className="toolbar">
        <input
          className="palette-name"
          value={palette.name}
          onChange={(e) => dispatch({ type: "rename", name: e.target.value })}
          aria-label="Palette name"
          spellCheck={false}
        />

        <div className="controls">
          <div className="stepper" role="group" aria-label="Columns">
            <span className="stepper-label">Columns</span>
            <button
              type="button"
              className="btn"
              onClick={() => dispatch({ type: "setColumns", columns: columns - 1 })}
              disabled={columns <= MIN_COLUMNS}
              aria-label="Fewer columns"
            >
              −
            </button>
            <span className="stepper-value" aria-live="polite">
              {columns}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => dispatch({ type: "setColumns", columns: columns + 1 })}
              disabled={columns >= MAX_COLUMNS}
              aria-label="More columns"
            >
              +
            </button>
          </div>

          <div className="file-actions">
            <button type="button" className="btn" onClick={() => importRef.current?.click()}>
              Import
            </button>
            <button type="button" className="btn" onClick={exportPalette}>
              Export
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ""; // so picking the same file again still fires
                if (file) importPalette(file);
              }}
            />
          </div>
        </div>
      </header>

      {importError && (
        <p className="notice" role="alert">
          {importError}
          <button type="button" onClick={() => setImportError(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={palette.swatches.map((s) => s.id)} strategy={noShuffle}>
          <main
            ref={gridRef}
            className="grid"
            style={{ "--columns": columns } as CSSProperties}
          >
            {palette.swatches.map((swatch) => (
              <SwatchTile
                key={swatch.id}
                swatch={swatch}
                columns={columns}
                autoFocus={swatch.id === focusId}
                getCellSize={getCellSize}
                onChange={(patch) => dispatch({ type: "update", id: swatch.id, patch })}
                onRemove={() => dispatch({ type: "remove", id: swatch.id })}
              />
            ))}

            <button
              type="button"
              className="add-tile"
              onClick={addBlank}
              aria-label="Add a colour"
            >
              +
            </button>
          </main>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeSwatch && (
            <div
              className={`swatch swatch-overlay${activeSwatch.hex ? "" : " is-blank"}`}
              style={
                {
                  "--swatch": activeSwatch.hex ?? undefined,
                  "--ink": activeSwatch.hex ? textColorFor(activeSwatch.hex) : undefined,
                } as CSSProperties
              }
            >
              <div className="swatch-meta">
                {activeSwatch.label && (
                  <span className="swatch-label">{activeSwatch.label}</span>
                )}
                <span className="swatch-hex">
                  {activeSwatch.hex?.toUpperCase() ?? "Empty"}
                </span>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {palette.swatches.length === 0 && (
        <p className="empty-hint">
          Press <strong>+</strong> to add your first colour, or paste hex codes anywhere on the page.
        </p>
      )}
    </div>
  );
}
