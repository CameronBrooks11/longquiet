// Keyboard model of an ARIA radio group: arrows move and wrap, Home and End
// jump to the ends. Returns the new index, or null for keys the group ignores.
export function moveIndex(
  current: number,
  key: string,
  count: number,
): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
