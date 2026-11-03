import { Conversation } from '../conversation/index.js';

/** Expose the conversation's authoritative state to the DOM layer.
 * Speech callbacks update this state only after Conversation.current() accepts
 * their session. No additional SpeechPort subscriptions are needed by the UI.
 */
export class WidgetConversation extends Conversation {
  get state() { return this.widgetState; }

  set state(value) {
    this.widgetState = value;
    // The base constructor sets its initial state before creating listeners.
    if (this.listeners) this.emit('state-change', { state: value });
  }
}
