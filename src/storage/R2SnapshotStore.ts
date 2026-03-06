/**
 * R2-based Snapshot Store Implementation
 *
 * This module provides a Cloudflare R2 object storage implementation of the ISnapshotStore interface.
 * Snapshots are stored as individual JSON files in R2 with a simple single-file-per-aggregate pattern.
 *
 * Storage Path Convention:
 * - Pattern: {aggregateType}/{aggregateId}/snapshot.json
 * - Example: account/acc-123/snapshot.json
 * - Single file per aggregate (overwrites on each save)
 *
 * Key Design Decisions:
 * - Latest snapshot wins (idempotent overwrites)
 * - Missing snapshots return null (expected case, not an error)
 * - Dependency injection pattern (R2Bucket passed to constructor) for testability
 * - R2 errors wrapped in domain-specific error types with context
 *
 * @packageDocumentation
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import type { ISnapshotStore, StoredSnapshot } from './interfaces';
import {
  SnapshotStoreError,
  SnapshotWriteError,
  SnapshotCorruptedError,
} from './errors';

/**
 * R2-based implementation of the ISnapshotStore interface.
 *
 * Persists snapshots to Cloudflare R2 object storage using a simple single-file pattern.
 * Each aggregate has one snapshot file that is overwritten on each save (latest wins).
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker with R2 binding
 * const snapshotStore = new R2SnapshotStore(env.SNAPSHOT_BUCKET);
 *
 * // Save a snapshot
 * await snapshotStore.save({
 *   aggregateType: 'account',
 *   aggregateId: 'acc-123',
 *   version: 42,
 *   timestamp: new Date().toISOString(),
 *   state: { id: 'acc-123', balance: 1500, transactions: 42 }
 * });
 *
 * // Load the latest snapshot
 * const snapshot = await snapshotStore.load('account', 'acc-123');
 * if (snapshot) {
 *   console.log(`Loaded snapshot at version ${snapshot.version}`);
 * } else {
 *   console.log('No snapshot exists yet');
 * }
 * ```
 */
export class R2SnapshotStore implements ISnapshotStore {
  /**
   * The R2 bucket used for snapshot storage.
   */
  private readonly bucket: R2Bucket;

  /**
   * Create a new R2SnapshotStore.
   *
   * @param bucket - The R2 bucket binding to use for snapshot storage
   *
   * @example
   * ```typescript
   * // In a Cloudflare Worker
   * export default {
   *   async fetch(request, env) {
   *     const snapshotStore = new R2SnapshotStore(env.SNAPSHOT_BUCKET);
   *     // Use snapshotStore...
   *   }
   * }
   * ```
   */
  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  /**
   * Persist a snapshot to R2 storage.
   *
   * The snapshot is serialized to JSON and written to R2 using a single-file pattern:
   * `{aggregateType}/{aggregateId}/snapshot.json`
   *
   * This operation is idempotent - saving a new snapshot overwrites any existing snapshot
   * for the same aggregate (latest version wins).
   *
   * @param snapshot - The snapshot to persist
   * @returns Promise that resolves when the snapshot is durably stored in R2
   * @throws {SnapshotWriteError} If the snapshot cannot be written to R2
   *
   * @example
   * ```typescript
   * await snapshotStore.save({
   *   aggregateType: 'account',
   *   aggregateId: 'acc-123',
   *   version: 42,
   *   timestamp: new Date().toISOString(),
   *   state: { id: 'acc-123', balance: 1500 }
   * });
   * // Snapshot saved to: account/acc-123/snapshot.json
   * ```
   */
  async save(snapshot: StoredSnapshot): Promise<void> {
    try {
      const key = this.buildSnapshotKey(
        snapshot.aggregateType,
        snapshot.aggregateId
      );
      const jsonContent = JSON.stringify(snapshot);

      await this.bucket.put(key, jsonContent);

      return Promise.resolve();
    } catch (error) {
      throw new SnapshotWriteError(
        `Failed to save snapshot for ${snapshot.aggregateType}/${snapshot.aggregateId} v${snapshot.version}`,
        {
          aggregateType: snapshot.aggregateType,
          aggregateId: snapshot.aggregateId,
          version: snapshot.version,
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  /**
   * Load the latest snapshot for an aggregate.
   *
   * Fetches the snapshot file from R2 and parses it. If no snapshot exists,
   * returns null (this is an expected case, not an error).
   *
   * @param aggregateType - Type of aggregate (e.g., "account")
   * @param aggregateId - Unique identifier of the aggregate instance
   * @returns Promise resolving to the latest snapshot, or null if no snapshot exists
   * @throws {SnapshotCorruptedError} If the snapshot data is invalid or corrupted
   * @throws {SnapshotStoreError} If the snapshot cannot be retrieved for other reasons
   *
   * @example
   * ```typescript
   * const snapshot = await snapshotStore.load('account', 'acc-123');
   *
   * if (snapshot) {
   *   console.log(`Loaded snapshot at version ${snapshot.version}`);
   *   // Use snapshot.state to restore aggregate state
   * } else {
   *   console.log('No snapshot exists - will restore from all events');
   * }
   * ```
   */
  async load(
    aggregateType: string,
    aggregateId: string
  ): Promise<StoredSnapshot | null> {
    try {
      const key = this.buildSnapshotKey(aggregateType, aggregateId);

      const snapshotObj = await this.bucket.get(key);

      // R2 returns null for missing objects - this is expected, not an error
      if (!snapshotObj) {
        return Promise.resolve(null);
      }

      // Parse the snapshot JSON
      const snapshotJson = await snapshotObj.text();

      try {
        const snapshot = JSON.parse(snapshotJson) as StoredSnapshot;
        return Promise.resolve(snapshot);
      } catch (parseError) {
        // JSON parse failure indicates corrupted data
        throw new SnapshotCorruptedError(
          `Snapshot data is corrupted for ${aggregateType}/${aggregateId}`,
          {
            aggregateType,
            aggregateId,
            cause:
              parseError instanceof Error
                ? parseError
                : new Error(String(parseError)),
          }
        );
      }
    } catch (error) {
      // Re-throw SnapshotCorruptedError as-is
      if (error instanceof SnapshotCorruptedError) {
        throw error;
      }

      // Wrap other R2 errors in SnapshotStoreError
      throw new SnapshotStoreError(
        `Failed to load snapshot for ${aggregateType}/${aggregateId}`,
        {
          aggregateType,
          aggregateId,
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  /**
   * Build the R2 object key for a snapshot.
   *
   * Constructs a simple single-file path:
   * `{aggregateType}/{aggregateId}/snapshot.json`
   *
   * @param aggregateType - Type of aggregate
   * @param aggregateId - ID of aggregate instance
   * @returns R2 object key
   *
   * @example
   * ```typescript
   * buildSnapshotKey('account', 'acc-123')
   * // Returns: "account/acc-123/snapshot.json"
   * ```
   */
  private buildSnapshotKey(
    aggregateType: string,
    aggregateId: string
  ): string {
    return `${aggregateType}/${aggregateId}/snapshot.json`;
  }
}
