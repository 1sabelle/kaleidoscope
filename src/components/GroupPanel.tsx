import { useCallback, useRef, useState } from "react";
import type { CSSProperties, Dispatch, KeyboardEvent, PointerEvent } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SwatchTile } from "./SwatchTile";
import type { CellSize } from "./SwatchTile";
import type { Group, GroupBox } from "../types";
import type { Side } from "../layout";
import { MAX_COLUMNS, MIN_COLUMNS, MIN_GROUP_HEIGHT, MIN_GROUP_WIDTH } from "../palette";
import type { Action } from "../palette";

/** Where a dragged group would land on this one, if it's the current target. */
export type DropZone = Side | "merge";

type Props = {
  group: Group;
  number: number; // position in reading order, shown as "No. 01"
  canRemove: boolean;
  focusId: string | null;
  dropZone: DropZone | null;
  dispatch: Dispatch<Action>;
  onAddBlank: () => void;
  onActivate: () => void;
};

// Tiles stay put while dragging (the target is highlighted instead), because
// shuffling differently-sized tiles mid-drag makes the grid jump around.
const noShuffle = () => null;

// Arrow keys on the corner handle change the size by this much.
const KEY_STEP = 20;
// Rows of a group with a set height stretch to fill it, but no shorter than this.
const MIN_ROW_HEIGHT = 64;

/** Compass points: which edges a handle moves. */
type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/**
 * Pin every group at the width it's showing right now. Done before any width
 * change, so dragging one group's edge moves that edge only and nothing reflows.
 */
function pinAllWidths(dispatch: Dispatch<Action>) {
  const panels = document.querySelectorAll<HTMLElement>("section.group[data-group-id]");
  const widths = Object.fromEntries(
    [...panels].map((el) => [el.dataset.groupId!, el.getBoundingClientRect().width]),
  );
  dispatch({ type: "pinWidths", widths });
}

/**
 * Drag one edge of a span by `delta`. The trailing edge (right/bottom) just
 * grows the size, up to `max`. The leading edge (left/top) keeps the far edge
 * still, trading size against the offset in front, so it can't push into
 * whatever is before it.
 */
function dragEdge(
  size: number,
  offset: number,
  delta: number,
  leading: boolean,
  min: number,
  max = Infinity,
) {
  if (!leading) return { size: Math.max(min, Math.min(size + delta, max)), offset };
  const next = Math.min(Math.max(min, size - delta), size + offset);
  return { size: next, offset: offset + size - next };
}

/**
 * The widest a group can get without anything leaving the screen: up to the
 * page's right margin, minus whatever sits to its right in the same row(s),
 * since growing pushes those along.
 */
function maxWidth(panel: HTMLElement) {
  const app = panel.closest<HTMLElement>(".app");
  if (!app) return Infinity;
  const right = app.getBoundingClientRect().right - parseFloat(getComputedStyle(app).paddingRight);
  let trailing = 0;
  let el: Element = panel.parentElement!; // the layout cell
  while (el.parentElement?.classList.contains("split")) {
    const parent = el.parentElement;
    if (parent.classList.contains("split-row")) {
      const gap = parseFloat(getComputedStyle(parent).columnGap) || 0;
      for (let next = el.nextElementSibling; next; next = next.nextElementSibling) {
        trailing += gap + next.getBoundingClientRect().width;
        trailing += parseFloat(getComputedStyle(next).marginLeft) || 0;
      }
    }
    el = parent;
  }
  return Math.max(MIN_GROUP_WIDTH, right - panel.getBoundingClientRect().left - trailing);
}

export function GroupPanel({
  group,
  number,
  canRemove,
  focusId,
  dropZone,
  dispatch,
  onAddBlank,
  onActivate,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState<string | null>(null); // "W × H" while dragging
  const { id: groupId, columns } = group;
  const data = { type: "group", groupId };
  // The header is what's picked up (so the floating copy is header-sized), but
  // only the grip starts a drag; the whole panel is the drop target.
  const {
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: `group:${groupId}`, data });
  const { setNodeRef: setDropRef } = useDroppable({ id: `group:${groupId}`, data });
  const { setNodeRef: setAddTileRef, isOver: isOverAddTile } = useDroppable({
    id: `add:${groupId}`,
    data: { type: "add-tile", groupId },
  });

  const getCellSize = useCallback((): CellSize => {
    const grid = gridRef.current;
    if (!grid) return { width: 160, height: 160, gap: 12 };
    const styles = getComputedStyle(grid);
    const gap = parseFloat(styles.columnGap) || 0;
    return {
      width: (grid.clientWidth - gap * (columns - 1)) / columns,
      // Rows stretch when the group has a set height, so read the real size.
      height: parseFloat(styles.gridTemplateRows) || parseFloat(styles.gridAutoRows) || 160,
      gap,
    };
  }, [columns]);

  /** The shortest this group can be and still fit its rows at their minimum. */
  function minHeight(panel: HTMLElement) {
    const grid = gridRef.current;
    if (!grid) return MIN_GROUP_HEIGHT;
    const styles = getComputedStyle(grid);
    const rows = styles.gridTemplateRows.split(" ").filter(Boolean).length || 1;
    const gap = parseFloat(styles.rowGap) || 0;
    const chrome = panel.getBoundingClientRect().height - grid.clientHeight;
    return Math.max(MIN_GROUP_HEIGHT, chrome + rows * MIN_ROW_HEIGHT + (rows - 1) * gap);
  }

  function removeGroup() {
    const count = group.swatches.length;
    const label = group.name.trim() || "this group";
    if (count > 0 && !confirm(`Delete “${label}” and its ${count} colour${count === 1 ? "" : "s"}?`)) {
      return;
    }
    dispatch({ type: "removeGroup", groupId });
  }

  function startResize(handle: Handle, e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const panel = target.parentElement!;
    const rect = panel.getBoundingClientRect();
    const horizontal = handle.includes("e") || handle.includes("w");
    const vertical = handle.includes("n") || handle.includes("s");
    const minH = minHeight(panel);
    const maxW = maxWidth(panel);
    const startX = e.clientX;
    const startY = e.clientY;
    if (horizontal) pinAllWidths(dispatch);

    const resize = (dx: number, dy: number) => {
      const box: GroupBox = {};
      const x = dragEdge(
        rect.width,
        group.offsetX ?? 0,
        dx,
        handle.includes("w"),
        MIN_GROUP_WIDTH,
        maxW,
      );
      const y = dragEdge(rect.height, group.offsetY ?? 0, dy, handle.includes("n"), minH);
      if (horizontal) Object.assign(box, { width: x.size, offsetX: x.offset });
      if (vertical) Object.assign(box, { height: y.size, offsetY: y.offset });
      dispatch({ type: "resizeGroup", groupId, box });
      const w = horizontal ? x.size : rect.width;
      const h = vertical ? y.size : rect.height;
      setResizing(`${Math.round(w)} × ${Math.round(h)}`);
    };
    resize(0, 0);

    const move = (ev: globalThis.PointerEvent) => resize(ev.clientX - startX, ev.clientY - startY);
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      setResizing(null);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }

  // Only the bottom-right corner is a keyboard stop (one per group, not eight):
  // left/right change the width, up/down the height.
  function resizeWithKeys(e: KeyboardEvent<HTMLDivElement>) {
    const step = ({
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    } as Record<string, [number, number]>)[e.key];
    if (!step) return;
    e.preventDefault();
    const panel = e.currentTarget.parentElement!;
    const rect = panel.getBoundingClientRect();
    if (step[0]) {
      pinAllWidths(dispatch);
      const width = Math.min(rect.width + step[0], maxWidth(panel));
      dispatch({ type: "resizeGroup", groupId, box: { width } });
    } else {
      const height = Math.max(minHeight(panel), rect.height + step[1]);
      dispatch({ type: "resizeGroup", groupId, box: { height } });
    }
  }

  /** Double-click: let the dimension(s) this handle controls follow the layout again. */
  function resetHandle(handle: Handle) {
    const box: { [K in keyof GroupBox]?: null } = {};
    if (handle.includes("e") || handle.includes("w")) Object.assign(box, { width: null, offsetX: null });
    if (handle.includes("n") || handle.includes("s")) Object.assign(box, { height: null, offsetY: null });
    dispatch({ type: "resizeGroup", groupId, box });
  }

  const className = ["group", isDragging && "is-dragging", resizing && "is-resizing"]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      ref={setDropRef}
      className={className}
      style={{ viewTransitionName: `group-${groupId}` }}
      data-group-id={groupId}
      onPointerDown={onActivate}
      onFocus={onActivate}
      aria-label={group.name || "Untitled group"}
    >
      <header ref={setDragRef} className="group-header">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="group-grip"
          {...attributes}
          {...listeners}
          aria-label={`Move group ${group.name}. Press space to pick up, arrows to choose a spot.`}
          title="Drag to move, or drop onto another group to merge"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="9" cy="6" r="1.4" />
            <circle cx="15" cy="6" r="1.4" />
            <circle cx="9" cy="12" r="1.4" />
            <circle cx="15" cy="12" r="1.4" />
            <circle cx="9" cy="18" r="1.4" />
            <circle cx="15" cy="18" r="1.4" />
          </svg>
        </button>

        <span className="group-number" aria-hidden="true">
          No. {String(number).padStart(2, "0")}
        </span>

        <input
          className="group-name"
          value={group.name}
          placeholder="Group name"
          autoFocus={groupId === focusId}
          onFocus={(e) => e.target.select()}
          onChange={(e) => dispatch({ type: "renameGroup", groupId, name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          aria-label="Group name"
          spellCheck={false}
        />

        <div className="group-controls">
          <div className="stepper" role="group" aria-label="Columns" title="Columns">
            <span className="stepper-label">Columns</span>
            <button
              type="button"
              className="btn"
              onClick={() => dispatch({ type: "setColumns", groupId, columns: columns - 1 })}
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
              onClick={() => dispatch({ type: "setColumns", groupId, columns: columns + 1 })}
              disabled={columns >= MAX_COLUMNS}
              aria-label="More columns"
            >
              +
            </button>
          </div>

          {canRemove && (
            <button
              type="button"
              className="group-remove"
              onClick={removeGroup}
              aria-label="Delete group"
              title="Delete group"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <SortableContext items={group.swatches.map((s) => s.id)} strategy={noShuffle}>
        <div ref={gridRef} className="grid" style={{ "--columns": columns } as CSSProperties}>
          {group.swatches.map((swatch) => (
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
            ref={setAddTileRef}
            type="button"
            className={`add-tile${isOverAddTile ? " is-drop-target" : ""}`}
            onClick={onAddBlank}
            aria-label={`Add a colour to ${group.name || "this group"}`}
          >
            +
          </button>
        </div>
      </SortableContext>

      {HANDLES.map((handle) => (
        <div
          key={handle}
          className={`group-handle group-handle-${handle}`}
          onPointerDown={(e) => startResize(handle, e)}
          onDoubleClick={() => resetHandle(handle)}
          title="Drag to resize · double-click to fit"
          {...(handle === "se"
            ? {
                role: "slider",
                tabIndex: 0,
                "aria-label": `Resize ${group.name || "group"}. Arrow keys change width and height; double-click to fit.`,
                "aria-valuetext": group.width || group.height
                  ? `${group.width ?? "auto"} by ${group.height ?? "auto"} pixels`
                  : "Automatic size",
                onKeyDown: resizeWithKeys,
              }
            : { "aria-hidden": true })}
        />
      ))}

      {resizing && <div className="group-size">{resizing}</div>}

      {dropZone && (
        <div className={`drop-indicator drop-${dropZone}`} aria-hidden="true">
          {dropZone === "merge" && <span>Merge into “{group.name || "Untitled group"}”</span>}
        </div>
      )}
    </section>
  );
}
