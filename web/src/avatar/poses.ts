export const MAIN_MOUTH_LABELS = ['Kapalı', 'Çok hafif açık', 'Hafif açık', 'Orta açık', 'Açık'];

// The source IDs stay stable. Opening order is deliberately not filename order.
export const MOUTH_POSES = [
  { id: 1, position: 0, label: MAIN_MOUTH_LABELS[0] },
  { id: 6, position: 1 / 3, label: '01 → 02 · ilk ara' },
  { id: 7, position: 2 / 3, label: '01 → 02 · ikinci ara' },
  { id: 2, position: 1, label: MAIN_MOUTH_LABELS[1] },
  { id: 8, position: 1.5, label: '02 → 03 · ara' },
  { id: 3, position: 2, label: MAIN_MOUTH_LABELS[2] },
  { id: 9, position: 2 + 1 / 3, label: '03 → 04 · ilk ara' },
  { id: 10, position: 2 + 2 / 3, label: '03 → 04 · ikinci ara' },
  { id: 4, position: 3, label: MAIN_MOUTH_LABELS[3] },
  { id: 11, position: 3 + 1 / 3, label: '04 → 05 · ilk ara' },
  { id: 12, position: 3 + 2 / 3, label: '04 → 05 · ikinci ara' },
  { id: 5, position: 4, label: MAIN_MOUTH_LABELS[4] },
] as const;

export const INTERMEDIATE_MOUTH_POSES = MOUTH_POSES.filter(pose => pose.id > 5);
export const PREVIEW_SEQUENCE = [1, 2, 3, 4, 5, 4, 3, 2, 1, 1, 2, 4, 3, 5, 3, 2] as const;
export const mouthLabel = (id: number) => MOUTH_POSES.find(pose => pose.id === id)?.label ?? MAIN_MOUTH_LABELS[0];
const positionOf = (id: number) => MOUTH_POSES.find(pose => pose.id === id)?.position ?? 0;

export function mouthBetween(from: number, to: number, progress: number): number {
  const start = positionOf(from), end = positionOf(to);
  const position = start + (end - start) * Math.max(0, Math.min(1, progress));
  let closest = MOUTH_POSES[0] as typeof MOUTH_POSES[number];
  for (const pose of MOUTH_POSES) {
    if (Math.abs(pose.position - position) < Math.abs(closest.position - position)) closest = pose;
  }
  return closest.id;
}

// Sample the original clock; inserting poses never increases the loop length.
export function previewFrame(elapsedMs: number, intervalMs: number): number {
  const interval = Math.max(1, intervalMs), elapsed = Math.max(0, elapsedMs);
  const index = Math.floor(elapsed / interval) % PREVIEW_SEQUENCE.length;
  return mouthBetween(PREVIEW_SEQUENCE[index], PREVIEW_SEQUENCE[(index + 1) % PREVIEW_SEQUENCE.length], (elapsed % interval) / interval);
}

export type TimedMouthCue = { start: number; end: number; frame: number };

// Reach each speech target inside its own cue. Long jumps can skip poses to
// respect the audio clock, instead of queuing an animation behind the voice.
export function speechFrame(cues: readonly TimedMouthCue[], elapsed: number, anchor = 1): number {
  if (elapsed < 0) return anchor;
  const index = cues.findIndex(cue => elapsed >= cue.start && elapsed < cue.end);
  if (index < 0) return 1;
  const cue = cues[index], from = index === 0 ? anchor : cues[index - 1].frame;
  const duration = Math.min(.05, (cue.end - cue.start) * .65);
  return mouthBetween(from, cue.frame, duration > 0 ? (elapsed - cue.start) / duration : 1);
}
