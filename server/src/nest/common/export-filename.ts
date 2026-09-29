/**
 * The filename half of every file export.
 *
 * Split out of `gpx-export.helpers.ts` when CSV and GeoJSON joined GPX and ICS as
 * things a trip can leave as. Names land on the receiving filesystem, so its
 * reserved characters are folded away rather than escaped; header safety is
 * `contentDisposition()`'s job since #2165, which is why the title's own script
 * survives here — 沖縄 stays 沖縄 instead of being mangled into underscores.
 */
export function exportFilename(title: string, extension: string): string {
  const base = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f"\\/:*?<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replaceAll(' ', '-');
  // Codepoints, not UTF-16 units: slice() would cut an emoji in half and the
  // lone surrogate is exactly what URI-encoding chokes on.
  return `${[...base].slice(0, 60).join('') || 'trip'}.${extension}`;
}
