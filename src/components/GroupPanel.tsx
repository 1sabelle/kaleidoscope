import { useCallback, useRef } from "react";
import type { CSSProperties, Dispatch } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SwatchTile } from "./SwatchTile";
import type { CellSize } from "./SwatchTile";
import type { Group } from "../types";
import type { Side } from "../layout";
import { MAX_COLUMNS, MIN_COLUMNS } from "../palette";
import type { Action } from "../palette";

/** Where a dragged group would land on this one, if it's the current target. */
export type DropZone = Side | "merge";

type Props = {
  group: Group;
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

export function GroupPanel({
  group,
  canRemove,
  focusId,
  dropZone,
  dispatch,
  onAddBlank,
  onActivate,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
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
      height: parseFloat(styles.gridAutoRows) || 160,
      gap,
    };
  }, [columns]);

  function removeGroup() {
    const count = group.swatches.length;
    const label = group.name.trim() || "this group";
    if (count > 0 && !confirm(`Delete “${label}” and its ${count} colour${count === 1 ? "" : "s"}?`)) {
      return;
    }
    dispatch({ type: "removeGroup", groupId });
  }

  const className = ["group", isDragging && "is-dragging"].filter(Boolean).join(" ");

  return (
    <section
      ref={setDropRef}
      className={className}
      style={{ viewTransitionName: `group-${groupId}` }}
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

      {dropZone && (
        <div className={`drop-indicator drop-${dropZone}`} aria-hidden="true">
          {dropZone === "merge" && <span>Merge into “{group.name || "Untitled group"}”</span>}
        </div>
      )}
    </section>
  );
}
