import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Logo } from './icons.tsx';

// Tablets and up: below 744×600 (iPad mini portrait, iPad landscape with browser chrome) the layout no longer fits.
const query = matchMedia('(max-width: 743.98px), (max-height: 599.98px)');
const subscribe = (change: () => void) => { query.addEventListener('change', change); return () => query.removeEventListener('change', change); };
export const useTooSmall = () => useSyncExternalStore(subscribe, () => query.matches);

// A native modal opened last, so it sits above any open dialog and the browser inerts everything under it.
// A layout effect, so close() runs while the dialog is still in the document and focus returns to where it was.
export function TooSmall() {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; el?.showModal();
    return () => el?.close();
  }, []);
  return <dialog ref={ref} className="too-small" aria-labelledby="too-small-title" onCancel={e => e.preventDefault()}>
    <Logo className="too-small-logo" />
    <p className="kicker">Screen too small</p>
    <h2 id="too-small-title">Directive needs a larger screen</h2>
    <p>Use a tablet or computer, or enlarge the window to at least 744 × 600.</p>
  </dialog>;
}
