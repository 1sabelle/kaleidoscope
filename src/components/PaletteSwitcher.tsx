import { useEffect, useRef, useState } from "react";
import type { LibraryEntry } from "../palette";
import { groupsOf } from "../layout";

type Props = {
  entries: LibraryEntry[];
  currentId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (name: string) => void;
};

const UNTITLED = "Untitled palette";

function colourCount(entry: LibraryEntry) {
  return groupsOf(entry.palette.layout).reduce((n, g) => n + g.swatches.length, 0);
}

/** The first few colours of a palette, as a little strip of dots. */
function ColourStrip({ entry }: { entry: LibraryEntry }) {
  const hexes = groupsOf(entry.palette.layout)
    .flatMap((g) => g.swatches)
    .flatMap((s) => (s.hex ? [s.hex] : []))
    .slice(0, 10);
  return (
    <span className="palette-strip" aria-hidden="true">
      {hexes.map((hex, i) => (
        <span key={i} style={{ background: hex }} />
      ))}
    </span>
  );
}

/**
 * The palette title. Clicking it lists the saved palettes to switch between,
 * start a new one, rename or delete; double-clicking renames straight away.
 */
export function PaletteSwitcher({ entries, currentId, onOpen, onNew, onDelete, onRename }: Props) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = entries.find((e) => e.id === currentId)!;
  const name = current.palette.name;
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function startRename() {
    setOpen(false);
    setRenaming(true);
  }

  function remove(entry: LibraryEntry) {
    const label = entry.palette.name.trim() || UNTITLED;
    if (confirm(`Delete “${label}”? This can’t be undone.`)) onDelete(entry.id);
  }

  return (
    <div className="palette-switcher" ref={rootRef}>
      {renaming ? (
        <input
          className="palette-name"
          value={name}
          placeholder={UNTITLED}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => onRename(e.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
          aria-label="Palette name"
          spellCheck={false}
        />
      ) : (
        <button
          type="button"
          className="palette-name palette-title"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onDoubleClick={startRename}
          title="Switch palette · double-click to rename"
        >
          <span className="palette-title-text">{name.trim() || UNTITLED}</span>
          <svg className="palette-title-chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}

      {open && (
        <div className="palette-menu" role="menu" aria-label="Saved palettes">
          <p className="palette-menu-heading">Saved palettes</p>
          <ul className="palette-list">
            {sorted.map((entry) => {
              const count = colourCount(entry);
              return (
                <li key={entry.id} className={entry.id === currentId ? "is-current" : undefined}>
                  <button
                    type="button"
                    role="menuitem"
                    className="palette-item"
                    aria-current={entry.id === currentId}
                    onClick={() => {
                      onOpen(entry.id);
                      setOpen(false);
                    }}
                  >
                    <span className="palette-item-name">
                      {entry.palette.name.trim() || UNTITLED}
                    </span>
                    <span className="palette-item-meta">
                      <ColourStrip entry={entry} />
                      {count} {count === 1 ? "colour" : "colours"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="palette-item-delete"
                    onClick={() => remove(entry)}
                    aria-label={`Delete ${entry.palette.name.trim() || UNTITLED}`}
                    title="Delete palette"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="palette-menu-actions">
            <button
              type="button"
              role="menuitem"
              className="text-btn"
              onClick={() => {
                onNew();
                setOpen(false);
              }}
            >
              New palette
            </button>
            <button type="button" role="menuitem" className="text-btn" onClick={startRename}>
              Rename
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
