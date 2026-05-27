/**
 * Parses a comma-separated DC note string into trimmed, non-empty IDs.
 * Returns lowercase IDs for case-insensitive comparison.
 */
export function parseDcNoteIds(dcNote: string): string[] {
  return dcNote
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0);
}

/**
 * Checks if all DC note IDs in a comma-separated string are present in the given set.
 */
export function areAllDcNotesPaid(
  dcNote: string,
  paidSet: Set<string>
): boolean {
  const noteIds = parseDcNoteIds(dcNote);
  return noteIds.length > 0 && noteIds.every((id) => paidSet.has(id));
}
