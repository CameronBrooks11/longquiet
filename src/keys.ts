// Keyboard model of an ARIA radio group or a horizontal tab list: arrows move
// and wrap, Home and End jump to the ends. A radio group also takes Up and
// Down; a horizontal tab list leaves them alone. Returns the new index, or
// null for keys the group ignores.
export function moveIndex(
  current: number,
  key: string,
  count: number,
  vertical = true,
): number | null {
  switch (key) {
    case "ArrowDown":
      if (!vertical) return null;
      return (current + 1) % count;
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowUp":
      if (!vertical) return null;
      return (current - 1 + count) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

// Which of a group's items takes the single tab stop: the selected one if it
// is among those shown, else the first shown.
export function tabStop<T>(shown: readonly T[], selected: T | null): T | null {
  if (selected !== null && shown.includes(selected)) return selected;
  return shown[0] ?? null;
}
