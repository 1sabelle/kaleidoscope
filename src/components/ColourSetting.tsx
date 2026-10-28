import { useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { useDroppable } from "@dnd-kit/core";
import { normalizeHex } from "../color";

type Props = {
  label: string; // what's being coloured, for the tooltip and screen readers
  value: string | undefined; // the custom colour, if one is set
  /** Reads the colour currently on screen, for when no custom one is set. */
  readCurrent: () => string | null;
  onChange: (hex: string | null) => void; // null goes back to the default colour
  align?: "left" | "right"; // which edge of the swatch the picker lines up with
  className?: string;
  /** Lets a colour tile be dropped on the swatch to use its colour. */
  dropId: string;
};

/** A round swatch showing a colour; clicking it opens a picker to change it. */
export function ColourSetting({
  label,
  value,
  readCurrent,
  onChange,
  align = "left",
  className,
  dropId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const shown = value ?? current ?? "#808080";
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: { type: "colour-setting", onChange },
  });

  // With no custom colour the swatch shows the default, read off the page.
  // That waits a frame: the theme is applied in the parent's effect, after ours.
  useEffect(() => {
    if (value) return;
    const frame = requestAnimationFrame(() => setCurrent(readCurrent()));
    return () => cancelAnimationFrame(frame);
  });

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

  function commitDraft() {
    const hex = draft === null ? null : normalizeHex(draft);
    if (hex) onChange(hex);
    setDraft(null);
  }

  return (
    <span className={["colour-setting", className].filter(Boolean).join(" ")} ref={rootRef}>
      <button
        ref={setNodeRef}
        type="button"
        className={`colour-swatch${isOver ? " is-drop-target" : ""}`}
        style={{ background: shown }}
        aria-expanded={open}
        aria-label={`${label} colour`}
        onClick={() => setOpen((o) => !o)}
        title={value ? `${label}: ${value.toUpperCase()}` : `${label}: default colour`}
      />

      {open && (
        <div
          className={`colour-popover colour-popover-${align}`}
          role="dialog"
          aria-label={`${label} colour`}
        >
          <HexColorPicker color={shown} onChange={onChange} />
          <div className="colour-popover-row">
            <input
              className="colour-hex"
              value={draft ?? shown.toUpperCase()}
              onFocus={(e) => {
                setDraft(e.target.value);
                e.target.select();
              }}
              onChange={(e) => {
                setDraft(e.target.value);
                const hex = normalizeHex(e.target.value);
                if (hex && e.target.value.replace("#", "").trim().length === 6) onChange(hex);
              }}
              onBlur={commitDraft}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              aria-label={`${label} hex code`}
              spellCheck={false}
              maxLength={7}
            />
            <button
              type="button"
              className="text-btn"
              onClick={() => onChange(null)}
              disabled={!value}
              title="Back to the default colour"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
