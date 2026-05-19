import { EventEmitter } from 'events';

// Singleton in-process event bus — fans out Link call events and floor mutations
// to all active SSE streams.
//
// Capacity: setMaxListeners(200) supports up to 200 concurrent host sessions
// across all restaurants in this process. Each open SSE tab = 1 listener.
// Node emits a warning when the count exceeds this; it is NOT a hard limit.
//
// Scale threshold: monitor `eventBus.listenerCount('incoming_call')` in prod logs.
// If sustained sessions regularly approach 150+, migrate to Redis pub/sub.
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(200);
