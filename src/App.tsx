import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
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
  ClientRect,
  Collision,
  CollisionDetection,
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent,
  KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { ColourSetting } from "./components/ColourSetting";
import { GroupPanel } from "./components/GroupPanel";
import { PaletteSwitcher } from "./components/PaletteSwitcher";
import type { DropZone } from "./components/GroupPanel";
import { parsePalette, serializePalette, useLibrary } from "./palette";
import { shareLink, takeSharedPalette } from "./share";
import { groupsOf, isFixed, layoutWeight } from "./layout";
import type { LayoutNode } from "./types";
import { parseHexList, textColorFor } from "./color";
import { renderedColour, useAppearance } from "./theme";
import type { Theme } from "./theme";

type Point = { x: number; y: number };

const isGroupDrag = (data: Record<string, unknown> | undefined) => data?.type === "group";
const isColourSetting = (data: Record<string, unknown> | undefined) =>
  data?.type === "colour-setting";

const centerOf = (rect: ClientRect): Point => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
});

/** How far a point is from a rectangle (0 when inside it). */
function distanceToRect({ x, y }: Point, rect: ClientRect) {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

// Near an edge of a group means "put it on that side"; the middle means merge.
// Edge bands are a quarter of the group, capped so big groups keep a big middle.
const EDGE_FRACTION = 0.25;
const MAX_EDGE = 96;
// Dropping in the gap next to a group still counts, but not from miles away.
const MAX_GROUP_REACH = 64;
// The round colour swatches are small, so a near miss still counts.
const COLOUR_SETTING_REACH = 12;

function dropZoneFor(point: Point, rect: ClientRect): DropZone {
  const edgeX = Math.min(rect.width * EDGE_FRACTION, MAX_EDGE);
  const edgeY = Math.min(rect.height * EDGE_FRACTION, MAX_EDGE);
  // Each distance as a fraction of its band; negative means outside that edge.
  const sides: [DropZone, number][] = [
    ["left", (point.x - rect.left) / edgeX],
    ["right", (rect.right - point.x) / edgeX],
    ["top", (point.y - rect.top) / edgeY],
    ["bottom", (rect.bottom - point.y) / edgeY],
  ];
  const [side, depth] = sides.reduce((a, b) => (b[1] < a[1] ? b : a));
  return depth < 1 ? side : "merge";
}

// Groups are matched on the pointer (or, for keyboard drags, the held header's
// centre), and the collision carries which side of the group it's on.
const groupCollision: CollisionDetection = ({
  active,
  collisionRect,
  droppableRects,
  droppableContainers,
  pointerCoordinates,
}) => {
  const point = pointerCoordinates ?? centerOf(collisionRect);
  let best: Collision | null = null;
  let bestDistance = MAX_GROUP_REACH;

  for (const container of droppableContainers) {
    const rect = droppableRects.get(container.id);
    if (!rect || !isGroupDrag(container.data.current)) continue;
    const distance = distanceToRect(point, rect);
    if (distance <= bestDistance) {
      bestDistance = distance;
      // Hovering the group's own spot is a no-op, so it gets no zone.
      const zone = container.id === active.id ? null : dropZoneFor(point, rect);
      best = { id: container.id, data: { droppableContainer: container, zone } };
    }
  }
  return best ? [best] : [];
};

// Tiles have different sizes, so "what's under the pointer" beats "nearest centre".
// Keyboard drags have no pointer, so they fall back to the nearest tile. Round
// colour swatches (background, group fills) come first, with a little reach.
const collisionDetection: CollisionDetection = (args) => {
  if (isGroupDrag(args.active.data.current)) return groupCollision(args);
  const point = args.pointerCoordinates ?? centerOf(args.collisionRect);
  for (const container of args.droppableContainers) {
    const rect = args.droppableRects.get(container.id);
    if (rect && isColourSetting(container.data.current)
      && distanceToRect(point, rect) <= COLOUR_SETTING_REACH) {
      return [{ id: container.id, data: { droppableContainer: container } }];
    }
  }
  const scoped = {
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (c) => !isGroupDrag(c.data.current),
    ),
  };
  const hits = pointerWithin(scoped);
  return hits.length > 0 ? hits : closestCenter(scoped);
};

/** The group a drag would land on, and where, from the current collisions. */
function groupDropOf(collisions: Collision[] | null) {
  const hit = collisions?.[0];
  const zone = hit?.data?.zone as DropZone | null | undefined;
  if (!hit || !zone) return null;
  return { groupId: String(hit.data?.droppableContainer.data.current.groupId), zone };
}

const ARROWS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

// How far inside a group's edge the keyboard lands, to aim at that side.
const KEYBOARD_EDGE_INSET = 12;

// Arrow keys jump the held tile onto the nearest tile in that direction. A held
// group instead hops between the middle and each edge of the other groups.
const keyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { active, context: { collisionRect, droppableRects, droppableContainers } },
) => {
  const dir = ARROWS[event.code];
  if (!dir || !collisionRect) return undefined;
  event.preventDefault();

  const holdingGroup = String(active).startsWith("group:");
  const candidates: Point[] = [];
  for (const container of droppableContainers.getEnabled()) {
    const rect = droppableRects.get(container.id);
    if (container.id === active || !rect) continue;
    if (isGroupDrag(container.data.current) !== holdingGroup) continue;
    const c = centerOf(rect);
    candidates.push(c);
    if (holdingGroup) {
      candidates.push(
        { x: rect.left + KEYBOARD_EDGE_INSET, y: c.y },
        { x: rect.right - KEYBOARD_EDGE_INSET, y: c.y },
        { x: c.x, y: rect.top + KEYBOARD_EDGE_INSET },
        { x: c.x, y: rect.bottom - KEYBOARD_EDGE_INSET },
      );
    }
  }

  const from = centerOf(collisionRect);
  let target: Point | undefined;
  let bestScore = Infinity;
  for (const point of candidates) {
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 1) continue; // behind us or level with us
    const across = Math.abs(dx * dir[1] + dy * dir[0]);
    const score = along + across * 2; // prefer targets straight ahead
    if (score < bestScore) {
      bestScore = score;
      target = point;
    }
  }

  // Coordinates are the held item's top-left; centre it on the target.
  return target && {
    x: target.x - collisionRect.width / 2,
    y: target.y - collisionRect.height / 2,
  };
};

/** Animate items sliding into their new spots where the browser supports it. */
function withTransition(update: () => void) {
  const run = () => flushSync(update);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (document.startViewTransition && !reduceMotion) document.startViewTransition(run);
  else run();
}

type ActiveDrag = { type: "swatch" | "group"; id: string };

export default function App() {
  const { palette, library, dispatch } = useLibrary();
  const [shared, setShared] = useState(false); // briefly true after copying a share link
  const { theme, colours, setTheme: applyTheme, setColour } = useAppearance();

  /** Picking a theme goes back to its own colours: background and every group. */
  function setTheme(next: Theme) {
    applyTheme(next);
    dispatch({ type: "clearGroupFills" });
  }
  const [focusId, setFocusId] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [groupDrop, setGroupDrop] = useState<{ groupId: string; zone: DropZone } | null>(null);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const groups = groupsOf(palette.layout);
  const swatchCount = groups.reduce((n, g) => n + g.swatches.length, 0);
  // Pasted colours go to the group last clicked or typed in, else the first one.
  const pasteGroupId = (groups.find((g) => g.id === currentGroupId) ?? groups[0]).id;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );

  function addBlank(groupId: string) {
    const id = crypto.randomUUID();
    dispatch({ type: "addBlank", groupId, id });
    setFocusId(id);
  }

  function addGroup() {
    const id = crypto.randomUUID();
    dispatch({ type: "addGroup", id });
    setFocusId(id);
    setCurrentGroupId(id);
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
      dispatch({ type: "add", groupId: pasteGroupId, hexes });
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [dispatch, pasteGroupId]);

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
    // Imports are saved as a new palette alongside the others, and opened.
    dispatch({ type: "addPalette", id: crypto.randomUUID(), palette: imported });
  }

  async function sharePalette() {
    const link = await shareLink(palette);
    try {
      await navigator.clipboard.writeText(link);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // No clipboard access: show the link so it can be copied by hand.
      prompt("Copy this link to share the palette:", link);
    }
  }

  // Opening a share link adds its palette to the library and opens it. Also
  // checked when the hash changes, e.g. a link pasted into this tab.
  useEffect(() => {
    async function receive() {
      const incoming = await takeSharedPalette();
      if (incoming === "unreadable") {
        setImportError("That share link is damaged or incomplete, so the palette couldn’t be opened.");
      } else if (incoming) {
        dispatch({ type: "addPalette", id: crypto.randomUUID(), palette: incoming });
      }
    }
    receive();
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, [dispatch]);

  function handleDragStart({ active }: DragStartEvent) {
    const data = active.data.current;
    // Moved tiles remount in their new group; don't let them grab focus again.
    setFocusId(null);
    setActiveDrag(
      isGroupDrag(data)
        ? { type: "group", id: String(data?.groupId) }
        : { type: "swatch", id: String(active.id) },
    );
  }

  function handleDragMove({ active, collisions }: DragMoveEvent) {
    if (!isGroupDrag(active.data.current)) return;
    const next = groupDropOf(collisions);
    setGroupDrop((prev) =>
      prev?.groupId === next?.groupId && prev?.zone === next?.zone ? prev : next,
    );
  }

  function endDrag() {
    setActiveDrag(null);
    setGroupDrop(null);
  }

  function handleDragEnd({ active, over, collisions }: DragEndEvent) {
    endDrag();
    const data = active.data.current;

    if (isGroupDrag(data)) {
      const drop = groupDropOf(collisions);
      if (!drop) return;
      const groupId = String(data?.groupId);
      withTransition(() =>
        dispatch(
          drop.zone === "merge"
            ? { type: "mergeGroup", groupId, intoId: drop.groupId }
            : { type: "moveGroup", groupId, targetId: drop.groupId, side: drop.zone },
        ),
      );
      return;
    }

    if (!over || over.id === active.id) return;
    const id = String(active.id);
    const target = over.data.current;
    // Dropping onto a round colour swatch gives it the tile's colour; the tile stays.
    if (isColourSetting(target)) {
      const hex = groups.flatMap((g) => g.swatches).find((s) => s.id === id)?.hex;
      if (hex) target?.onChange(hex);
      return;
    }
    // Dropping onto a tile swaps the two; dropping onto a group's + moves the
    // colour to the end of that group. Everything else stays where it is.
    withTransition(() =>
      dispatch(
        target?.type === "add-tile"
          ? { type: "moveSwatch", id, groupId: String(target.groupId) }
          : { type: "swap", id, withId: String(over.id) },
      ),
    );
  }

  function renderNode(node: LayoutNode): ReactNode {
    const fixed = isFixed(node) ? " is-fixed" : "";
    if (node.kind === "split") {
      return (
        <div
          key={node.id}
          className={`split split-${node.direction}${fixed}`}
          style={{ "--weight": layoutWeight(node) } as CSSProperties}
        >
          {node.children.map(renderNode)}
        </div>
      );
    }
    const style = {
      "--weight": node.columns,
      "--width": `${node.width}px`,
      "--height": `${node.height}px`,
      "--offset-x": `${node.offsetX ?? 0}px`,
      "--offset-y": `${node.offsetY ?? 0}px`,
    } as CSSProperties;
    const tall = node.height !== undefined ? " has-height" : "";
    return (
      <div key={node.id} className={`layout-cell${fixed}${tall}`} style={style}>
        <GroupPanel
          group={node}
          canRemove={groups.length > 1}
          focusId={focusId}
          dropZone={groupDrop?.groupId === node.id ? groupDrop.zone : null}
          dispatch={dispatch}
          onAddBlank={() => addBlank(node.id)}
          onActivate={() => setCurrentGroupId(node.id)}
        />
      </div>
    );
  }

  const activeSwatch =
    activeDrag?.type === "swatch"
      ? groups.flatMap((g) => g.swatches).find((s) => s.id === activeDrag.id)
      : undefined;
  const activeGroup =
    activeDrag?.type === "group" ? groups.find((g) => g.id === activeDrag.id) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
      <div className="app">
        <ColourSetting
          label="Background"
          value={colours.background}
          readCurrent={() => renderedColour("body")}
          onChange={(hex) => setColour("background", hex)}
          align="right"
          className="background-colour"
          dropId="fill:background"
        />

        <header className="toolbar">
          <div className="masthead">
            <p className="kicker">Kaleidoscope · Palette</p>
            <PaletteSwitcher
              entries={library.entries}
              currentId={library.currentId}
              onOpen={(id) => dispatch({ type: "openPalette", id })}
              onNew={() => dispatch({ type: "newPalette", id: crypto.randomUUID() })}
              onDelete={(id) => dispatch({ type: "deletePalette", id })}
              onRename={(name) => dispatch({ type: "rename", name })}
            />
            <p className="palette-meta">
              {groups.length} {groups.length === 1 ? "group" : "groups"} · {swatchCount}{" "}
              {swatchCount === 1 ? "colour" : "colours"}
            </p>
          </div>

          <div className="controls">
            <div className="text-actions" role="group" aria-label="Layout">
              {groups.some((g) => g.width ?? g.height ?? g.offsetX ?? g.offsetY) && (
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => dispatch({ type: "resetSizes" })}
                  title="Undo hand-picked group sizes so groups fill the screen again"
                >
                  Fit to screen
                </button>
              )}
              <button type="button" className="text-btn" onClick={addGroup}>
                Add group
              </button>
            </div>

            <div className="text-actions theme-switch" role="group" aria-label="Theme">
              {(["system", "light", "dark"] as Theme[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="text-btn"
                  aria-pressed={theme === option}
                  onClick={() => setTheme(option)}
                  title={option === "system" ? "Follow your system setting" : undefined}
                >
                  {option === "system" ? "Auto" : option}
                </button>
              ))}
            </div>

            <div className="text-actions" role="group" aria-label="File">
              <button
                type="button"
                className="text-btn"
                onClick={() => importRef.current?.click()}
              >
                Import
              </button>
              <button type="button" className="text-btn" onClick={exportPalette}>
                Export
              </button>
              <button
                type="button"
                className="text-btn"
                onClick={sharePalette}
                title="Copy a link that opens this palette"
              >
                {shared ? "Link copied" : "Share"}
              </button>
            </div>
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
        </header>

        {importError && (
          <p className="notice" role="alert">
            {importError}
            <button type="button" onClick={() => setImportError(null)} aria-label="Dismiss">
              ×
            </button>
          </p>
        )}

        <main
          className={[
            "layout",
            isFixed(palette.layout) && "is-fixed",
            activeGroup && "is-moving-group",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {renderNode(palette.layout)}
        </main>

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
          {activeGroup && (
            <div className="group-chip">
              <span className="group-chip-name">{activeGroup.name || "Untitled group"}</span>
              <span className="group-chip-swatches" aria-hidden="true">
                {activeGroup.swatches.slice(0, 8).map((s) => (
                  <span
                    key={s.id}
                    className={s.hex ? undefined : "is-blank"}
                    style={{ background: s.hex ?? undefined }}
                  />
                ))}
              </span>
            </div>
          )}
        </DragOverlay>

        {swatchCount === 0 && (
          <p className="empty-hint">
            Press <strong>+</strong> to add your first colour, or paste hex codes anywhere on the page.
          </p>
        )}
      </div>
    </DndContext>
  );
}
