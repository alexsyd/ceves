/**
 * Decorator Module Exports for Ceves Event Sourcing Library
 *
 * Provides public API for event handler decorators.
 *
 * @packageDocumentation
 */

export {
  EventHandler,
  getEventHandlers,
  findEventHandler,
  clearEventHandlers,
  executeSideEffects,
} from './EventHandler';

export type { IEventHandler, EventHandlerEntry } from './EventHandler';
