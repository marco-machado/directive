export type Tone = 'info' | 'danger' | 'good' | 'objective';
export type CalloutPart = { title: string; detail?: string };
export type Callout = { id: number; tone: Tone; parts: CalloutPart[]; at: number };

export const SHOW_MS = 1600;
// Callouts arriving this close together share one line.
export const MERGE_MS = 300;
export const QUEUE_MAX = 2;

const SEVERITY: Record<Tone, number> = { info: 0, good: 1, objective: 2, danger: 3 };

// Adds a callout at time `now` (ms), merging it into the newest one when they arrive within MERGE_MS.
// A merge takes a new id so the line restarts its display time, and the line keeps the more severe tone.
export function enqueue(queue: Callout[], id: number, tone: Tone, part: CalloutPart, now: number): Callout[] {
  const last = queue.at(-1);
  if (last && now - last.at <= MERGE_MS) {
    const merged = { id, tone: SEVERITY[tone] > SEVERITY[last.tone] ? tone : last.tone, parts: [...last.parts, part], at: now };
    return [...queue.slice(0, -1), merged];
  }
  return [...queue, { id, tone, parts: [part], at: now }].slice(-QUEUE_MAX);
}
