/**
 * R2-based Event Store Implementation
 *
 * This module provides a Cloudflare R2 object storage implementation of the IEventStore interface.
 * Events are stored as individual JSON files in R2 with a structured path convention that enables
 * efficient querying and maintains event ordering through zero-padded version numbers.
 *
 * Storage Path Convention:
 * - Pattern: {aggregateType}/{aggregateId}/{paddedVersion}.json
 * - Example: account/acc-123/000000001.json, account/acc-123/000000042.json
 * - Version numbers are zero-padded to 9 digits for lexicographic sorting
 *
 * Key Design Decisions:
 * - One file per event (append-only, immutable)
 * - Zero-padded version numbers enable correct ordering via R2's list operation
 * - Dependency injection pattern (R2Bucket passed to constructor) for testability
 * - R2 errors wrapped in domain-specific error types with context
 *
 * @packageDocumentation
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import type { IEventStore, StoredEvent } from './interfaces';
import { EventStoreError, EventWriteError } from './errors';

/**
 * R2-based implementation of IEventStore.
 *
 * Persists events to Cloudflare R2 object storage using a structured file path convention.
 * Each event is stored as a separate JSON file, enabling append-only semantics and
 * efficient incremental loading.
 *
 * For snapshot storage, use R2SnapshotStore or D1SnapshotStore instead.
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker with R2 binding
 * const eventStore = new R2EventStore(env.EVENTS_BUCKET);
 *
 * // Save an event
 * await eventStore.save({
 *   aggregateType: 'account',
 *   aggregateId: 'acc-123',
 *   version: 1,
 *   type: 'AccountCreated',
 *   timestamp: new Date().toISOString(),
 *   orgId: 'org-456',
 *   event: { type: 'AccountCreated', ... }
 * });
 *
 * // Load all events for an aggregate
 * const events = await eventStore.loadAll('account', 'acc-123');
 *
 * // Load events after version 10 (incremental loading)
 * const recentEvents = await eventStore.load('account', 'acc-123', 10);
 * ```
 */
export class R2EventStore implements IEventStore {
  /**
   * The R2 bucket used for event storage.
   */
  private readonly eventsBucket: R2Bucket;

  /**
   * Create a new R2EventStore.
   *
   * @param eventsBucket - The R2 bucket binding to use for event storage
   *
   * @example
   * ```typescript
   * // In a Cloudflare Worker
   * export default {
   *   async fetch(request, env) {
   *     const eventStore = new R2EventStore(env.EVENTS_BUCKET);
   *     // Use eventStore...
   *   }
   * }
   * ```
   */
  constructor(eventsBucket: R2Bucket) {
    this.eventsBucket = eventsBucket;
  }

  /**
   * Persist an event to R2 storage.
   *
   * Serialized to JSON and written to R2 using path: `{aggregateType}/{aggregateId}/{paddedVersion}.json`
   * Version numbers are zero-padded to 9 digits for lexicographic sorting.
   *
   * @param event - The event to persist
   * @returns Promise that resolves when the event is durably stored in R2
   * @throws {EventWriteError} If the event cannot be written to R2
   */
  async save(event: StoredEvent): Promise<void> {
    try {
      const key = this.buildEventKey(event.aggregateType, event.aggregateId, event.version);
      const jsonContent = JSON.stringify(event);

      await this.eventsBucket.put(key, jsonContent);

      return Promise.resolve();
    } catch (error) {
      throw new EventWriteError(
        `Failed to save event for ${event.aggregateType}/${event.aggregateId} v${event.version}`,
        {
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          version: event.version,
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  /**
   * Load events for an aggregate with optional filtering by version.
   *
   * Lists all event files for the aggregate from R2 using a prefix-based query,
   * optionally filters to events after a specific version, fetches each event file,
   * and returns events in ascending version order.
   *
   * @param aggregateType - Type of aggregate (e.g., "account")
   * @param aggregateId - Unique identifier of the aggregate instance
   * @param afterVersion - Optional. Only return events with version > afterVersion
   * @returns Promise resolving to ordered array of events, or empty array if none found
   * @throws {EventStoreError} If events cannot be retrieved from R2
   *
   * @example
   * ```typescript
   * // Load all events
   * const allEvents = await eventStore.load('account', 'acc-123');
   *
   * // Load only events after version 10 (e.g., after a snapshot)
   * const recentEvents = await eventStore.load('account', 'acc-123', 10);
   * // Returns events with version 11, 12, 13, ...
   * ```
   */
  async load(
    aggregateType: string,
    aggregateId: string,
    afterVersion?: number
  ): Promise<StoredEvent[]> {
    try {
      const prefix = `${aggregateType}/${aggregateId}/`;

      // List all event files for this aggregate
      const listed = await this.eventsBucket.list({ prefix });

      // Filter by afterVersion if specified
      const relevantObjects = listed.objects.filter((obj) => {
        if (afterVersion === undefined) {
          return true;
        }

        // Extract version from key: "account/acc-123/000000042.json" → 42
        const versionStr = obj.key.split('/')[2]?.replace('.json', '');
        if (!versionStr) {
          return false;
        }

        const version = parseInt(versionStr, 10);
        return version > afterVersion;
      });

      // Fetch and parse each event file
      const events: StoredEvent[] = [];
      for (const obj of relevantObjects) {
        const eventObj = await this.eventsBucket.get(obj.key);
        if (!eventObj) {
          // Object was deleted between list and get - skip it
          continue;
        }

        const eventJson = await eventObj.text();
        const event = JSON.parse(eventJson) as StoredEvent;
        events.push(event);
      }

      // Sort by version ascending to ensure deterministic ordering
      events.sort((a, b) => a.version - b.version);

      return Promise.resolve(events);
    } catch (error) {
      throw new EventStoreError(
        `Failed to load events for ${aggregateType}/${aggregateId}`,
        {
          aggregateType,
          aggregateId,
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  /**
   * Load all events for an aggregate.
   *
   * Convenience method equivalent to calling `load(aggregateType, aggregateId)` without afterVersion.
   * Returns events in ascending version order (1, 2, 3...).
   *
   * @param aggregateType - Type of aggregate (e.g., "account")
   * @param aggregateId - Unique identifier of the aggregate instance
   * @returns Promise resolving to ordered array of all events, or empty array if none found
   * @throws {EventStoreError} If events cannot be retrieved from R2
   *
   * @example
   * ```typescript
   * const events = await eventStore.loadAll('account', 'acc-123');
   * console.log(`Loaded ${events.length} events`);
   * ```
   */
  async loadAll(
    aggregateType: string,
    aggregateId: string
  ): Promise<StoredEvent[]> {
    return this.load(aggregateType, aggregateId);
  }

  /**
   * Build the R2 object key for an event.
   *
   * Constructs a structured path with zero-padded version number:
   * `{aggregateType}/{aggregateId}/{paddedVersion}.json`
   *
   * @param aggregateType - Type of aggregate
   * @param aggregateId - ID of aggregate instance
   * @param version - Event version number
   * @returns R2 object key
   *
   * @example
   * ```typescript
   * buildEventKey('account', 'acc-123', 42)
   * // Returns: "account/acc-123/000000042.json"
   * ```
   */
  private buildEventKey(
    aggregateType: string,
    aggregateId: string,
    version: number
  ): string {
    const paddedVersion = this.padVersion(version);
    return `${aggregateType}/${aggregateId}/${paddedVersion}.json`;
  }

  /**
   * Zero-pad a version number to 9 digits for lexicographic sorting.
   *
   * Converts a version number to a zero-padded string that sorts correctly
   * lexicographically. This enables R2's list operation to return events in
   * the correct order without additional sorting.
   *
   * @param version - Version number to pad
   * @returns Zero-padded version string (9 digits)
   *
   * @example
   * ```typescript
   * padVersion(1)    // Returns: "000000001"
   * padVersion(42)   // Returns: "000000042"
   * padVersion(1337) // Returns: "000001337"
   * ```
   */
  private padVersion(version: number): string {
    return version.toString().padStart(9, '0');
  }

}
