import { EventEmitter } from 'events';

// Singleton in-process event bus.
// Currently used to fan out Link call events to all active SSE streams.
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(200); // allow many concurrent host sessions
