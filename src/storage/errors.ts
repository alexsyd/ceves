/**
 * Storage Error Definitions for Ceves Event Sourcing Library
 *
 * This module defines typed error classes for event and snapshot storage operations.
 * These errors provide structured context about storage failures, enabling proper
 * error handling and debugging in event sourcing workflows.
 *
 * Key Design Decisions:
 * - Hierarchical error structure (base EventStoreError extended by specific errors)
 * - Context properties (aggregateType, aggregateId, version) for debugging
 * - Separate error types for different failure modes (write, read, corruption)
 * - Return HTTP 500 status codes (storage errors are internal server errors)
 *
 * @packageDocumentation
 */

import { CevesError } from '../errors/CevesError';

/** Common context shape for storage errors */
interface StorageErrorContext {
  aggregateType?: string;
  aggregateId?: string;
  version?: number;
  cause?: Error;
}

/**
 * Base error class for all event store operations.
 *
 * Extends CevesError with additional context properties specific to
 * event sourcing storage operations. All event store errors should
 * extend this base class.
 * Returns HTTP 500 Internal Server Error responses (storage failures are server errors).
 *
 * @example
 * ```typescript
 * throw new EventStoreError(
 *   'Failed to load events',
 *   { aggregateType: 'account', aggregateId: 'acc-123' }
 * );
 * ```
 */
export class EventStoreError extends CevesError {
  /**
   * Event version number involved in the failed operation (if applicable).
   */
  public readonly version?: number;

  /**
   * Original error that caused this error (if applicable).
   */
  public override readonly cause?: Error;

  /**
   * Create a new EventStoreError.
   *
   * Returns HTTP 500 status (storage errors are internal server errors).
   *
   * @param message - Human-readable error description
   * @param context - Optional context about the operation (aggregateType, aggregateId, version, cause)
   */
  constructor(message: string, context?: StorageErrorContext) {
    super(message, 500, context?.aggregateType, context?.aggregateId);
    this.version = context?.version;
    this.cause = context?.cause;
  }
}

/**
 * Error thrown when an event cannot be written to storage.
 *
 * This error indicates a failure during the save operation, such as:
 * - Network failures communicating with storage backend
 * - Permission denied errors
 * - Storage backend unavailability
 * - Serialization failures
 * Returns HTTP 500 Internal Server Error responses.
 *
 * @example
 * ```typescript
 * throw new EventWriteError(
 *   'Failed to write event to R2',
 *   {
 *     aggregateType: 'account',
 *     aggregateId: 'acc-123',
 *     version: 5,
 *     cause: originalError
 *   }
 * );
 * ```
 */
export class EventWriteError extends EventStoreError {
  /**
   * Create a new EventWriteError.
   *
   * @param message - Human-readable error description
   * @param context - Context about the failed write operation
   */
  constructor(message: string, context?: StorageErrorContext) {
    super(message, context);
  }
}

/**
 * Base error class for all snapshot store operations.
 *
 * Extends CevesError with additional context properties specific to
 * snapshot storage operations. All snapshot store errors should extend
 * this base class.
 * Returns HTTP 500 Internal Server Error responses (storage failures are server errors).
 *
 * @example
 * ```typescript
 * throw new SnapshotStoreError(
 *   'Failed to load snapshot',
 *   { aggregateType: 'account', aggregateId: 'acc-123' }
 * );
 * ```
 */
export class SnapshotStoreError extends CevesError {
  /**
   * Snapshot version number involved in the failed operation (if applicable).
   */
  public readonly version?: number;

  /**
   * Original error that caused this error (if applicable).
   */
  public override readonly cause?: Error;

  /**
   * Create a new SnapshotStoreError.
   *
   * Returns HTTP 500 status (storage errors are internal server errors).
   *
   * @param message - Human-readable error description
   * @param context - Optional context about the operation
   */
  constructor(message: string, context?: StorageErrorContext) {
    super(message, 500, context?.aggregateType, context?.aggregateId);
    // Assign version and cause from context (snapshot-specific)
    this.cause = context?.cause;
    this.version = context?.version;
  }
}

/**
 * Error thrown when a snapshot cannot be written to storage.
 *
 * This error indicates a failure during the snapshot save operation.
 * Returns HTTP 500 Internal Server Error responses.
 *
 * @example
 * ```typescript
 * throw new SnapshotWriteError(
 *   'Failed to write snapshot to storage',
 *   {
 *     aggregateType: 'account',
 *     aggregateId: 'acc-123',
 *     version: 42,
 *     cause: originalError
 *   }
 * );
 * ```
 */
export class SnapshotWriteError extends SnapshotStoreError {
  /**
   * Create a new SnapshotWriteError.
   *
   * @param message - Human-readable error description
   * @param context - Context about the failed write operation
   */
  constructor(message: string, context?: StorageErrorContext) {
    super(message, context);
  }
}

/**
 * Error thrown when a snapshot's data is invalid or corrupted.
 *
 * This error indicates that a snapshot was retrieved from storage but
 * its data is malformed, unparseable, or fails validation.
 * Returns HTTP 500 Internal Server Error responses.
 *
 * @example
 * ```typescript
 * throw new SnapshotCorruptedError(
 *   'Snapshot JSON is malformed',
 *   {
 *     aggregateType: 'account',
 *     aggregateId: 'acc-123',
 *     cause: jsonParseError
 *   }
 * );
 * ```
 */
export class SnapshotCorruptedError extends SnapshotStoreError {
  /**
   * Create a new SnapshotCorruptedError.
   *
   * @param message - Human-readable error description
   * @param context - Context about the corrupted snapshot
   */
  constructor(message: string, context?: StorageErrorContext) {
    super(message, context);
  }
}
