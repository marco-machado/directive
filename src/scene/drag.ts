// How far the pointer got from the last press. A one-finger drag turns the view, so a drag must never count
// as a click, even one that comes back to where it started: R3F's e.delta only measures press to release.
let far = 0, x0 = 0, y0 = 0;
export function trackDrags(el: HTMLElement) {
  const down = (e: PointerEvent) => { if (e.isPrimary) { far = 0; x0 = e.clientX; y0 = e.clientY; } };
  const move = (e: PointerEvent) => { if (e.isPrimary && e.buttons) far = Math.max(far, Math.hypot(e.clientX - x0, e.clientY - y0)); };
  el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
  return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); };
}
export const dragged = () => far > 5;

// A single finger (or pen) held still this long is a long press, touch's Shift+click: `act` runs with the press's
// client coordinates while it is still held. A drag or a second finger calls it off. The click a browser may send
// on release is swallowed before R3F, which listens further up, can see it.
export const LONG_PRESS_MS = 500;
export function trackLongPress(el: HTMLElement, act: (x: number, y: number) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined, fired = false;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  // Only the first finger down is primary, so any other press calls the long press off.
  const down = (e: PointerEvent) => {
    fired = false; cancel();
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    const { clientX: x, clientY: y } = e;
    timer = setTimeout(() => { timer = undefined; if (!dragged()) { fired = true; act(x, y); } }, LONG_PRESS_MS);
  };
  const move = () => { if (timer !== undefined && dragged()) cancel(); };
  const up = () => cancel();
  const click = (e: Event) => { if (fired) { fired = false; e.stopImmediatePropagation(); } };
  el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('click', click, true);
  return () => {
    cancel();
    el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('click', click, true);
  };
}
