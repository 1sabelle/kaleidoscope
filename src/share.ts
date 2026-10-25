import type { Palette } from "./types";
import { parsePalette, serializePalette } from "./palette";

/*
 * Sharing without a server: the palette's export JSON travels in the link
 * itself, after `#palette=`. It's deflated and base64url-encoded to keep links
 * short, and lives in the hash so it never reaches a server.
 */

const HASH_KEY = "palette";
// Links come from anyone, and a tiny one could inflate to gigabytes (a "zip
// bomb") and freeze the tab. Real palettes are a few KB; stop well past that.
const MAX_DECODED_BYTES = 1024 * 1024;

/**
 * Run bytes through a (de)compression stream. With `limit`, gives up (throws)
 * as soon as the output grows past it, rather than producing all of it first.
 */
async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit = Infinity,
) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    total += next.value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Shared palette is too large");
    }
    chunks.push(next.value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** A link that opens this palette in anyone's copy of the app. */
export async function shareLink(palette: Palette): Promise<string> {
  const json = new TextEncoder().encode(serializePalette(palette));
  const code = toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
  return `${location.origin}${location.pathname}#${HASH_KEY}=${code}`;
}

/**
 * If the address has a shared palette in it, take it out (so a reload doesn't
 * add it again) and return it: null if there's none, "unreadable" if the link
 * is damaged. The hash is cleared before the first await, so a second call
 * straight after (React's dev double-run) finds nothing.
 */
export async function takeSharedPalette(): Promise<Palette | "unreadable" | null> {
  const code = new URLSearchParams(location.hash.slice(1)).get(HASH_KEY);
  if (!code) return null;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    const json = await pipe(
      fromBase64Url(code),
      new DecompressionStream("deflate-raw"),
      MAX_DECODED_BYTES,
    );
    return parsePalette(JSON.parse(new TextDecoder().decode(json))) ?? "unreadable";
  } catch {
    return "unreadable";
  }
}
