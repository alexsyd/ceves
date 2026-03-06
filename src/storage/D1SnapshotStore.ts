/**
 * D1-based Snapshot Store Implementation
 *
 * This module provides a Cloudflare D1 SQLite database implementation of the ISnapshotStore interface.
 * Snapshots are stored as rows in a SQL table with automatic schema initialization.
 *
 * Storage Schema:
 * - Table: snapshots
 * - Columns: aggregate_type TEXT, aggregate_id TEXT, version INTEGER, timestamp TEXT, state TEXT (JSON)
 * - PRIMARY KEY: (aggregate_type, aggregate_id)
 * - Upsert behavior: INSERT OR REPLACE (latest snapshot wins)
 *
 * Key Design Decisions:
 * - Automatic schema creation (CREATE TABLE IF NOT EXISTS on first use)
 * - Latest snapshot wins (idempotent overwrites via INSERT OR REPLACE)
 * - Missing snapshots return null (expected case, not an error)
 * - Dependency injection pattern (D1Database passed to constructor) for testability
 * - D1 errors wrapped in domain-specific error types with context
 * - Prepared statements with bound parameters for SQL injection prevention
 *
 * @packageDocumentation
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { ISnapshotStore, StoredSnapshot } from './interfaces';
import {
  SnapshotStoreError,
  SnapshotWriteError,
  SnapshotCorruptedError,
} from './errors';

/**
 * D1-based implementation of the ISnapshotStore interface.
 *
 * Persists snapshots to Cloudflare D1 SQLite database using a simple table schema.
 * Each aggregate has one snapshot row that is overwritten on each save (latest wins).
 * Table schema is created automatically on first use.
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker with D1 binding
 * const snapshotStore = new D1SnapshotStore(env.SNAPSHOTS_DB);
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
export class D1SnapshotStore implements ISnapshotStore {
  /**
   * The D1 database used for snapshot storage.
   */
  private readonly db: D1Database;

  /**
   * Flag to track if table initialization has been attempted.
   * Prevents redundant CREATE TABLE calls after first use.
   */
  private tableInitialized = false;

  /**
   * Create a new D1SnapshotStore.
   *
   * @param db - The D1 database binding to use for snapshot storage
   *
   * @example
   * ```typescript
   * // In a Cloudflare Worker
   * export default {
   *   async fetch(request, env) {
   *     const snapshotStore = new D1SnapshotStore(env.SNAPSHOTS_DB);
   *     // Use snapshotStore...
   *   }
   * }
   * ```
   */
  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Persist a snapshot to D1 storage.
   *
   * The snapshot is serialized to JSON and written to D1 using INSERT OR REPLACE:
   * - If no snapshot exists for the aggregate, a new row is inserted
   * - If a snapshot exists, it is replaced with the new snapshot (latest wins)
   *
   * This operation is idempotent - saving a new snapshot overwrites any existing snapshot
   * for the same aggregate.
   *
   * @param snapshot - The snapshot to persist
   * @returns Promise that resolves when the snapshot is durably stored in D1
   * @throws {SnapshotWriteError} If the snapshot cannot be written to D1
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
   * // Snapshot saved to D1: snapshots table
   * ```
   */
  async save(snapshot: StoredSnapshot): Promise<void> {
    try {
      // Ensure table exists before write
      await this.ensureTableExists();

      // Serialize state to JSON string
      const stateJson = JSON.stringify(snapshot.state);

      // Insert or replace snapshot (upsert behavior)
      await this.db
        .prepare(
          `INSERT OR REPLACE INTO snapshots
           (aggregate_type, aggregate_id, version, timestamp, state)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          snapshot.aggregateType,
          snapshot.aggregateId,
          snapshot.version,
          snapshot.timestamp,
          stateJson
        )
        .run();

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
   * Queries the D1 database for the snapshot row matching the aggregate.
   * If no snapshot exists, returns null (this is an expected case, not an error).
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
      // Ensure table exists before query
      await this.ensureTableExists();

      // Query for snapshot row
      const row = await this.db
        .prepare(
          `SELECT * FROM snapshots
           WHERE aggregate_type = ? AND aggregate_id = ?`
        )
        .bind(aggregateType, aggregateId)
        .first();

      // D1 returns null for missing rows - this is expected, not an error
      if (!row) {
        return Promise.resolve(null);
      }

      // Parse the snapshot JSON from state column
      try {
        const snapshot: StoredSnapshot = {
          aggregateType: row.aggregate_type as string,
          aggregateId: row.aggregate_id as string,
          version: row.version as number,
          timestamp: row.timestamp as string,
          state: JSON.parse(row.state as string),
        };
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

      // Wrap other D1 errors in SnapshotStoreError
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
   * Ensure the snapshots table exists in the D1 database.
   *
   * Creates the table if it doesn't exist using CREATE TABLE IF NOT EXISTS.
   * This operation is idempotent - safe to call multiple times.
   * Uses a flag to avoid redundant CREATE TABLE calls after first successful initialization.
   *
   * Table Schema:
   * - aggregate_type TEXT NOT NULL
   * - aggregate_id TEXT NOT NULL
   * - version INTEGER NOT NULL
   * - timestamp TEXT NOT NULL
   * - state TEXT NOT NULL (JSON-serialized)
   * - PRIMARY KEY (aggregate_type, aggregate_id)
   *
   * @private
   * @throws {SnapshotStoreError} If table creation fails
   */
  private async ensureTableExists(): Promise<void> {
    // Skip if already initialized
    if (this.tableInitialized) {
      return;
    }

    try {
      await this.db
        .prepare(
          `CREATE TABLE IF NOT EXISTS snapshots (
             aggregate_type TEXT NOT NULL,
             aggregate_id TEXT NOT NULL,
             version INTEGER NOT NULL,
             timestamp TEXT NOT NULL,
             state TEXT NOT NULL,
             PRIMARY KEY (aggregate_type, aggregate_id)
           )`
        )
        .run();

      this.tableInitialized = true;
    } catch (error) {
      throw new SnapshotStoreError(
        'Failed to initialize snapshots table',
        {
          aggregateType: '',
          aggregateId: '',
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }
}
