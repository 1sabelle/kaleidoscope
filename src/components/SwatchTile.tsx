import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, SyntheticEvent } from "react";
import { HexColorPicker } from "react-colorful";
import { useSortable } from "@dnd-kit/sortable";
import type { Swatch } from "../types";
import { normalizeHex, randomHex, textColorFor } from "../color";
import { MAX_ROW_SPAN } from "../palette";

export type CellSize = { width: number; height: number; gap: number };

type Props = {
  swatch: Swatch;
  columns: number;
  autoFocus?: boolean;
  getCellSize: () => CellSize;
  onChange: (patch: Partial<Omit<Swatch, "id">>) => void;
  onRemove: () => void;
};

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/** Drags start from the tile itself, never from its inputs, buttons or picker. */
function startsOnControl(e: SyntheticEvent) {
  return (e.target as HTMLElement).closest("input, button, .picker-popover") !== null;
}

export function SwatchTile({
  swatch,
  columns,
  autoFocus,
  getCellSize,
  onChange,
  onRemove,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const [copied, setCopied] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const hexRef = useRef<HTMLInputElement>(null);
  const { setNodeRef, attributes, listeners, isDragging, isOver } = useSortable({
    id: swatch.id,
    data: { type: "swatch" },
  });

  // A swatch can be wider than the grid after columns are reduced; draw it clamped.
  const colSpan = Math.min(swatch.colSpan, columns);
  const rowSpan = swatch.rowSpan;
  const blank = swatch.hex === null;

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (e: globalThis.PointerEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [pickerOpen]);

  function handleHexInput(value: string) {
    setHexDraft(value);
    // Apply as soon as a full 6-digit code is typed; 3-digit codes apply on blur.
    const hex = normalizeHex(value);
    if (hex && value.replace("#", "").trim().length === 6) onChange({ hex });
  }

  function commitHex() {
    const hex = hexDraft === null ? null : normalizeHex(hexDraft);
    if (hex) onChange({ hex });
    setHexDraft(null);
  }

  async function copyHex() {
    if (!swatch.hex) return;
    try {
      await navigator.clipboard.writeText(swatch.hex.toUpperCase());
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access can be denied; nothing useful to do.
    }
  }

  function startResize(e: PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const cell = getCellSize();
    const startX = e.clientX;
    const startY = e.clientY;
    let last = { colSpan, rowSpan };
    setResizing(true);

    const move = (ev: globalThis.PointerEvent) => {
      const next = {
        colSpan: clamp(
          Math.round(colSpan + (ev.clientX - startX) / (cell.width + cell.gap)),
          1,
          columns,
        ),
        rowSpan: clamp(
          Math.round(rowSpan + (ev.clientY - startY) / (cell.height + cell.gap)),
          1,
          MAX_ROW_SPAN,
        ),
      };
      if (next.colSpan !== last.colSpan || next.rowSpan !== last.rowSpan) {
        last = next;
        onChange(next);
      }
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setResizing(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function resizeWithKeys(e: KeyboardEvent<HTMLButtonElement>) {
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    onChange({
      colSpan: clamp(colSpan + d[0], 1, columns),
      rowSpan: clamp(rowSpan + d[1], 1, MAX_ROW_SPAN),
    });
  }

  const style = {
    "--swatch": swatch.hex ?? undefined,
    "--ink": swatch.hex ? textColorFor(swatch.hex) : undefined,
    gridColumn: `span ${colSpan}`,
    gridRow: `span ${rowSpan}`,
    viewTransitionName: `swatch-${swatch.id}`,
  } as CSSProperties;

  // Keys only start a drag when the tile itself is focused (not while typing in
  // its inputs); mouse/touch drags never start on a control.
  const dragListeners = Object.fromEntries(
    Object.entries(listeners ?? {}).map(([name, handler]) => [
      name,
      (e: SyntheticEvent) => {
        const allowed =
          name === "onKeyDown" ? e.target === e.currentTarget : !startsOnControl(e);
        if (allowed) handler(e);
      },
    ]),
  );

  const className = [
    "swatch",
    blank && "is-blank",
    pickerOpen && "is-picking",
    resizing && "is-resizing",
    isDragging && "is-dragging",
    isOver && !isDragging && "is-drop-target",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={setNodeRef}
      className={className}
      style={style}
      {...attributes}
      {...dragListeners}
      onClick={(e) => {
        // Clicking anywhere on the tile (not a control) jumps straight to the hex
        // code with it selected, so you can just click and type.
        if (startsOnControl(e)) return;
        hexRef.current?.focus();
        hexRef.current?.select();
      }}
      aria-label={`${swatch.label || "Colour"} ${swatch.hex?.toUpperCase() ?? "(empty)"}. Press space to pick up and move.`}
    >
      <div className="swatch-actions">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setPickerOpen((open) => !open)}
          aria-label="Pick colour"
          title="Pick colour"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => onChange({ hex: randomHex() })}
          aria-label="Random colour"
          title="Random colour"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="3" />
            <circle className="die-pip" cx="9" cy="9" r="1.2" />
            <circle className="die-pip" cx="15" cy="15" r="1.2" />
            <circle className="die-pip" cx="15" cy="9" r="1.2" />
            <circle className="die-pip" cx="9" cy="15" r="1.2" />
          </svg>
        </button>
        {!blank && (
          <button
            type="button"
            className="icon-btn"
            onClick={copyHex}
            aria-label="Copy hex code"
            title={copied ? "Copied!" : "Copy hex code"}
          >
            {copied ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="8" y="8" width="12" height="12" rx="2" />
                <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
              </svg>
            )}
          </button>
        )}
        {!blank && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => onChange({ hex: null })}
            aria-label="Clear colour"
            title="Clear colour"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8" />
              <path d="M6.5 17.5l11-11" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={onRemove}
          aria-label="Remove colour"
          title="Remove colour"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {pickerOpen && (
        <div className="picker-popover" ref={pickerRef}>
          <HexColorPicker
            color={swatch.hex ?? "#808080"}
            onChange={(hex) => onChange({ hex })}
          />
        </div>
      )}

      <div className="swatch-meta">
        <input
          className="swatch-label"
          value={swatch.label}
          placeholder="Add label"
          onChange={(e) => onChange({ label: e.target.value })}
          aria-label="Colour label"
          spellCheck={false}
        />
        <div className="swatch-hex-row">
          <input
            ref={hexRef}
            className="swatch-hex"
            value={hexDraft ?? swatch.hex?.toUpperCase() ?? ""}
            placeholder="#HEX"
            autoFocus={autoFocus}
            onFocus={(e) => {
              setHexDraft(e.target.value);
              e.target.select();
            }}
            onChange={(e) => handleHexInput(e.target.value)}
            onBlur={commitHex}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            aria-label="Hex code"
            spellCheck={false}
            maxLength={7}
          />
        </div>
      </div>

      {resizing && (
        <div className="swatch-size">
          {colSpan} × {rowSpan}
        </div>
      )}

      <button
        type="button"
        className="resize-handle"
        onPointerDown={startResize}
        onKeyDown={resizeWithKeys}
        aria-label={`Resize colour, currently ${colSpan} by ${rowSpan}. Use arrow keys.`}
        title="Drag to resize"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M11 4L4 11M11 8L8 11" />
        </svg>
      </button>
    </div>
  );
}
