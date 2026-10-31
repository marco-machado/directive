// How far the pointer got from the last press. Left-drag orbits the view, so a drag must never count
// as a click, even one that comes back to where it started: R3F's e.delta only measures press to release.
let far = 0, x0 = 0, y0 = 0;
export function trackDrags(el: HTMLElement) {
  const down = (e: PointerEvent) => { if (e.isPrimary) { far = 0; x0 = e.clientX; y0 = e.clientY; } };
  const move = (e: PointerEvent) => { if (e.isPrimary && e.buttons) far = Math.max(far, Math.hypot(e.clientX - x0, e.clientY - y0)); };
  el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
  return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); };
}
export const dragged = () => far > 5;
