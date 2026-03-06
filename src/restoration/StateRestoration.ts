/**
 * @module StateRestoration
 * @description State restoration engine for event sourcing.
 * Provides pure functions to rebuild aggregate state from event history and snapshots.
 *
 * Key Functions:
 * - `restoreState()`: Snapshot-first state restoration with incremental event loading
 * - `restoreFromEvents()`: Pure event replay engine that applies events sequentially
 * - Used by CevesApp for automatic state restoration before command handler execution
 *
 * Performance: <1ms per event (pure function, no I/O), <100ms total with snapshot optimization
 *
 * @packageDocumentation
 */

import type {
  StoredEvent,
  StoredSnapshot,
  IEventStore,
  ISnapshotStore,
} from '../storage/interfaces';
import type { BaseState } from '../schemas/State';
import { applyEventToState } from '../decorators/EventHandler';
import { VersionConflictError } from '../errors/VersionConflictError';

/**
 * Restore state from event array using registered event handlers.
 *
 * This is a pure function that applies events sequentially to rebuild aggregate state.
 * Events MUST be pre-sorted by version (ascending order) before calling this function.
 *
 * **Process ( Updated):**
 * 1. Start with initialState (or null for new aggregates)
 * 2. For each event:
 *    - Apply event via `applyEventToState()` helper
 *    - Helper finds handler, validates event, and applies to state
 *    - Framework auto-sets timestamp and version (handler sets id and orgId)
 * 3. Return final state after all events applied
 *
 * **Error Handling:**
 * - Missing handler: Throws EventApplicationError with helpful message
 * - Schema validation failure: Propagates ZodError with event context
 * - Apply failure: Propagates error from handler.apply()
 *
 * **Performance:**
 * - Target: <1ms per event (pure function, no I/O)
 * - O(1) handler lookup via Map registry
 * - No event cloning (events are immutable read-only)
 * - Sequential processing (no parallel overhead)
 *
 * @template TState - The aggregate state type (should extend BaseState with version field)
 *
 * @param events - Events to apply (ordered by version, ascending)
 * @param initialState - Starting state (null for new aggregate, or snapshot state for incremental)
 * @param StateClass - State class constructor for creating empty state
 * @returns Final state after applying all events, or initialState if events array is empty
 *
 * @throws {EventApplicationError} If event handler is not registered for an event type
 * @throws {ZodError} If event fails schema validation
 *
 * @example
 * ```typescript
 * // Full event replay from beginning (no snapshot)
 * const events = await eventStore.loadAll('account', 'acc-123');
 * const state = await restoreFromEvents(events, null, AccountState);
 * // state.version === events[events.length - 1].version
 *
 * // Incremental replay from snapshot
 * const snapshot = await snapshotStore.load('account', 'acc-123');
 * const newEvents = await eventStore.load('account', 'acc-123', snapshot.version);
 * const state = await restoreFromEvents(newEvents, snapshot.state, AccountState);
 * // state includes snapshot + new events
 * ```
 *
 * @example
 * ```typescript
 * // Empty events array returns initialState unchanged
 * const state = await restoreFromEvents([], initialState, AccountState);
 * // state === initialState
 *
 * // Null initialState with first event creates initial state
 * const events = [accountCreatedEvent];
 * const state = await restoreFromEvents(events, null, AccountState);
 * // Handler receives AccountState.empty() instead of null
 * ```
 */
export function restoreFromEvents<TState extends BaseState>(
  events: StoredEvent[],
  initialState: TState | null = null,
  StateClass: new () => TState
): TState | null {
  // Handle empty events array - return initialState unchanged
  if (events.length === 0) {
    return initialState;
  }

  // Start with initialState (null for new aggregates, or snapshot state for incremental)
  let state = initialState;

  // Apply events sequentially in array order
  for (const event of events) {
    // Apply event using helper function (finds handler, validates, applies to state)
    state = applyEventToState(event.aggregateType, state, event, StateClass);
  }

  // Return final state after all events applied
  return state;
}

/**
 * Validate that state version matches the last event version.
 *
 * This is a critical validation step that detects bugs in event handlers where the
 * apply() method fails to correctly update state.version to match the event.version.
 * Version consistency is essential for incremental loading patterns and state integrity.
 *
 * **When to Use:**
 * - After applying events via restoreFromEvents()
 * - Before returning final state from restoreState()
 * - Only when events.length > 0 (skip for empty events array)
 *
 * **Error Detection:**
 * - Catches event handlers that don't update version field
 * - Provides diagnostic info: expected vs actual version, aggregateId
 * - Prevents silent state corruption bugs
 *
 * @template TState - The aggregate state type (must extend BaseState with version field)
 *
 * @param state - The state after applying events (or null if aggregate doesn't exist)
 * @param events - The events that were applied to produce this state
 *
 * @throws {VersionConflictError} If state.version !== lastEvent.version
 *
 * @example
 * ```typescript
 * // After applying events, validate version consistency
 * const finalState = await restoreFromEvents(events, initialState);
 * validateStateVersion(finalState, events);  // Throws if version mismatch
 * return finalState;
 * ```
 *
 * @example
 * ```typescript
 * // Skip validation for empty events (no events to validate against)
 * if (events.length === 0) {
 *   return initialState;  // No validation needed
 * }
 * const finalState = await restoreFromEvents(events, initialState);
 * validateStateVersion(finalState, events);  // Only validate when events were applied
 * ```
 */
function validateStateVersion<TState extends BaseState>(
  state: TState | null,
  events: StoredEvent[]
): void {
  // No validation needed if state is null or no events were applied
  if (!state || events.length === 0) {
    return;
  }

  // Get the last event (most recent)
  const lastEvent = events[events.length - 1];

  // Validate that state.version matches the last event's version
  if (lastEvent && state.version !== lastEvent.version) {
    throw new VersionConflictError(
      `Version mismatch after state restoration for aggregate "${lastEvent.aggregateId}": expected version ${lastEvent.version} (from last event), but state.version is ${state.version}. This indicates a bug in the event handler's apply() method.`,
      lastEvent.version,
      state.version,
      lastEvent.aggregateType,
      lastEvent.aggregateId
    );
  }
}

/**
 * Restore aggregate state from snapshot + incremental events.
 *
 * This function implements the snapshot-first optimization strategy for state restoration.
 * Instead of replaying the entire event history, it loads the latest snapshot (if exists)
 * and only replays events that occurred after the snapshot was created.
 *
 * **Process:**
 * 1. Load snapshot from snapshotStore (null if none exists)
 * 2. Determine starting state and afterVersion filter:
 *    - If snapshot exists: use snapshot.state and snapshot.version
 *    - If no snapshot: use null state and version 0
 * 3. Load incremental events with version > afterVersion
 * 4. If no new events: return snapshot state (optimization)
 * 5. Apply incremental events to snapshot state via restoreFromEvents()
 * 6. Return final state
 *
 * **Performance Optimization:**
 * - Snapshot-first approach reduces event replay from potentially thousands to <100 events
 * - Incremental loading (afterVersion filter) minimizes data transfer
 * - No-new-events optimization avoids unnecessary restoreFromEvents() call
 * - Target: <100ms for aggregates with <100 events since snapshot
 *
 * **Error Handling:**
 * - Snapshot load errors: Propagates SnapshotCorruptedError, SnapshotStoreError
 * - Event load errors: Propagates EventStoreError
 * - Event application errors: Propagates EventApplicationError, ZodError
 *
 * @template TState - The aggregate state type (must extend BaseState with version field)
 *
 * @param aggregateType - Type of aggregate (e.g., "account", "order")
 * @param aggregateId - Unique identifier of the aggregate instance
 * @param eventStore - Event storage implementation
 * @param snapshotStore - Snapshot storage implementation
 * @returns Current aggregate state (null if never existed), or snapshot state if no new events
 *
 * @throws {EventApplicationError} If event handler missing or apply fails
 * @throws {SnapshotCorruptedError} If snapshot data is invalid
 * @throws {SnapshotStoreError} If snapshot cannot be retrieved
 * @throws {EventStoreError} If events cannot be retrieved
 * @throws {ZodError} If event fails schema validation
 *
 * @example
 * ```typescript
 * // Restore state with snapshot optimization
 * const state = await restoreState<AccountState>(
 *   'account',
 *   'acc-123',
 *   eventStore,
 *   snapshotStore
 * );
 * // If snapshot at version 100 exists, only replays events 101+
 *
 * // No snapshot case - falls back to full replay
 * const state = await restoreState<AccountState>(
 *   'account',
 *   'acc-new',
 *   eventStore,
 *   snapshotStore
 * );
 * // Loads all events from version 1, behaves like restoreFromEvents(allEvents, null)
 * ```
 *
 * @example
 * ```typescript
 * // Used by CevesApp before command handler execution
 * async function handleCommand<TState extends BaseState>(
 *   command: BaseCommand,
 *   eventStore: IEventStore,
 *   snapshotStore: ISnapshotStore
 * ) {
 *   // Restore current state automatically
 *   const state = await restoreState<TState>(
 *     command.aggregateType,
 *     command.aggregateId,
 *     eventStore,
 *     snapshotStore
 *   );
 *
 *   // Execute command handler with restored state
 *   const event = await commandHandler.execute(command, state);
 *
 *   // Persist event
 *   await eventStore.save(event);
 * }
 * ```
 */
export async function restoreState<TState extends BaseState>(
  aggregateType: string,
  aggregateId: string,
  eventStore: IEventStore,
  snapshotStore: ISnapshotStore,
  StateClass: new () => TState
): Promise<TState | null> {
  // 1. Load snapshot (null if doesn't exist)
  const snapshot: StoredSnapshot | null = await snapshotStore.load(
    aggregateType,
    aggregateId
  );

  // 2. Determine starting state and version
  const initialState: TState | null = snapshot
    ? (snapshot.state as TState)
    : null;
  const afterVersion: number = snapshot ? snapshot.version : 0;

  // 3. Load incremental events (only events with version > afterVersion)
  const events: StoredEvent[] = await eventStore.load(
    aggregateType,
    aggregateId,
    afterVersion
  );

  // 4. If no new events, return snapshot state without replay (optimization)
  if (events.length === 0) {
    return initialState;
  }

  // 5. Apply incremental events to snapshot state (pass StateClass)
  const finalState = restoreFromEvents<TState>(events, initialState, StateClass);

  // 6. Validate version consistency after restoration
  validateStateVersion(finalState, events);

  return finalState;
}
