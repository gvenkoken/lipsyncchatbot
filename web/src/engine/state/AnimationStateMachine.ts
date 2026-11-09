import type { SpeechPort, SpeechSettings } from '../../speech/SpeechPort';

export type AnimationState = 'Idle' | 'Speaking' | 'Thinking';
export type StateWeights = Readonly<Record<AnimationState, number>>;
export interface AnimationSnapshot {
  readonly target: AnimationState;
  readonly progress: number;
  readonly weights: StateWeights;
}

const pose = (state: AnimationState): StateWeights => ({
  Idle: state === 'Idle' ? 1 : 0,
  Speaking: state === 'Speaking' ? 1 : 0,
  Thinking: state === 'Thinking' ? 1 : 0,
});

/** React-free, timer-free machine. The frame loop supplies elapsed milliseconds.
 * The SpeechPort remains owned by the caller. Its adapters must suppress events
 * from cancelled utterances (SpeechEvent has no utterance identifier).
 */
export class AnimationStateMachine {
  private target: AnimationState = 'Idle';
  private from: StateWeights = pose('Idle');
  private elapsed: number;
  private generation = 0;
  private unsubscribe?: () => void;
  private disposed = false;

  constructor(private readonly speech: SpeechPort, readonly blendMs = 200) {
    if (!Number.isFinite(blendMs) || blendMs < 150 || blendMs > 300) {
      throw new RangeError('State blend must be between 150 and 300 milliseconds.');
    }
    this.elapsed = blendMs;
  }

  get snapshot(): AnimationSnapshot {
    const progress = Math.min(1, this.elapsed / this.blendMs);
    const destination = pose(this.target);
    const weights = Object.freeze({
      Idle: this.from.Idle * (1 - progress) + destination.Idle * progress,
      Speaking: this.from.Speaking * (1 - progress) + destination.Speaking * progress,
      Thinking: this.from.Thinking * (1 - progress) + destination.Thinking * progress,
    });
    return Object.freeze({ target: this.target, progress, weights });
  }

  update(deltaMs: number): AnimationSnapshot {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new RangeError('State delta must be finite and nonnegative.');
    }
    this.elapsed = Math.min(this.blendMs, this.elapsed + deltaMs);
    return this.snapshot;
  }

  setState(state: 'Idle' | 'Thinking'): void {
    if (this.disposed) return;
    this.cancel();
    this.transition(state);
  }

  stop(): void { this.setState('Idle'); }

  speak(text: string, settings: SpeechSettings = { rate: 1, pitch: 1 }): void {
    if (this.disposed) return;
    this.cancel();
    this.transition('Speaking');
    const generation = this.generation;
    this.unsubscribe = this.speech.subscribe(event => {
      if (this.disposed || generation !== this.generation) return;
      if (event.type === 'end') {
        this.generation++;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.transition('Idle');
      }
    });
    this.speech.speak(text, settings);
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.transition('Idle');
    this.disposed = true;
  }

  private cancel(): void {
    // Invalidate first: cancel may synchronously deliver a terminal event.
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.speech.cancel();
  }

  private transition(target: AnimationState): void {
    // Preserve the visible mixture when a command interrupts a transition.
    this.from = this.snapshot.weights;
    this.target = target;
    this.elapsed = 0;
  }
}
