/**
 * Deterministic normalization for cross-provider track identity.
 * Pure functions — no provider APIs, no LLMs.
 */

const FEAT_RE = /\s*[([]\s*(feat|ft|with)\.?\s+.*[)\]]/gi;
const VERSION_NOISE = [
  /\s*[-–(]\s*(remaster(ed)?([^\])]*))?\s*([)\]])?/gi,
  /\b\d{4}\s+(remaster(ed)?|version|mix|edition)\b/gi,
  /\b(remaster(ed)?|single version|album version|radio edit|mono|stereo|deluxe|explicit|clean)\b/gi,
  /\s*[-–]\s*(from|feat)\b.*$/gi,
];

export function normalizeTitle(title: string): string {
  let t = title.toLowerCase();
  t = t.replace(FEAT_RE, " ");
  for (const re of VERSION_NOISE) t = t.replace(re, " ");
  t = t.replace(/[^\p{L}\p{N}\s&]/gu, " ");
  return t.replace(/\s+/g, " ").trim();
}

export function normalizeArtist(artist: string): string {
  let a = artist.toLowerCase();
  a = a.replace(/\s*(feat|ft|with)\.?\s+.*$/gi, " ");
  a = a.replace(/[^\p{L}\p{N}\s&]/gu, " ");
  return a.replace(/\s+/g, " ").trim();
}

export function normalizeIsrc(isrc: string | null | undefined): string | null {
  if (!isrc) return null;
  const cleaned = isrc.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return cleaned.length === 12 ? cleaned : null;
}

/**
 * Identity key for dedupe: ISRC wins when known, else normalized title+artist.
 * Clean/explicit variants and remasters intentionally collapse to one key when
 * they share an ISRC; remasters with distinct ISRCs are distinct keys (matched
 * only via metadata fallback with lower confidence).
 */
export function dedupeKey(opts: { isrc?: string | null; title: string; artist: string }): string {
  const isrc = normalizeIsrc(opts.isrc);
  if (isrc) return `isrc:${isrc}`;
  return `meta:${normalizeTitle(opts.title)}|${normalizeArtist(opts.artist)}`;
}

export const DURATION_TOLERANCE_MS = 2500;

export function durationsClose(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return true; // unknown durations don't disqualify
  return Math.abs(a - b) <= DURATION_TOLERANCE_MS;
}
