const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "264653", "#264653" or "#264" -> "#264653". Returns null if not a hex colour. */
export function normalizeHex(input: string): string | null {
  const match = input.trim().match(HEX_RE);
  if (!match) return null;
  let hex = match[1].toLowerCase();
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  return `#${hex}`;
}

/**
 * Pull every valid hex code out of pasted text: "264653, #2a9d8f e9c46a",
 * "264653-2a9d8f-e9c46a", or a coolors.co URL.
 */
export function parseHexList(input: string): string[] {
  return input
    .split(/[\s,;/-]+/)
    .map(normalizeHex)
    .filter((hex): hex is string => hex !== null);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Whether dark text reads better than light text on top of `hex`. */
export function isLight(hex: string): boolean {
  return luminance(hex) > 0.179;
}

/** Black or white, whichever reads better on top of `hex` (WCAG contrast). */
export function textColorFor(hex: string): string {
  return isLight(hex) ? "#111111" : "#ffffff";
}

/**
 * A computed CSS colour ("rgb(246, 246, 244)", or "color(srgb 0.96 0.96 0.95)"
 * as browsers report color-mix() results) as "#rrggbb", or null.
 */
export function cssColorToHex(css: string): string | null {
  const rgb = css.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  const srgb = css.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  const channels = rgb
    ? rgb.slice(1, 4).map(Number)
    : srgb?.slice(1, 4).map((c) => Number(c) * 255);
  if (!channels) return null;
  return `#${channels.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** A random colour that avoids muddy greys and neon extremes. */
export function randomHex(): string {
  const h = Math.random() * 360;
  const s = 0.45 + Math.random() * 0.35;
  const l = 0.4 + Math.random() * 0.3;
  return hslToHex(h, s, l);
}
