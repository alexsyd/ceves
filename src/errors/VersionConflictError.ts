/**
 * Version Conflict Error for Ceves Event Sourcing Library
 */

import { CevesError, CevesErrorJSON } from './CevesError';

/**
 * JSON representation of VersionConflictError
 */
interface VersionConflictErrorJSON extends CevesErrorJSON {
  expectedVersion: number;
  actualVersion: number;
}

/**
 * Error thrown when a version conflict is detected.
 *
 * This error occurs when attempting to append an event with a version
 * that doesn't match the expected next version, indicating a concurrent
 * modification or optimistic locking failure.
 * Returns HTTP 409 Conflict responses.
 *
 * @example
 * ```typescript
 * import { VersionConflictError } from './VersionConflictError';
 *
 * async function appendEvent(event: BaseEvent) {
 *   const currentVersion = await getCurrentVersion(
 *     event.aggregateType,
 *     event.aggregateId
 *   );
 *
 *   const expectedVersion = currentVersion + 1;
 *
 *   if (event.version !== expectedVersion) {
 *     throw new VersionConflictError(
 *       `Expected version ${expectedVersion} but got ${event.version}`,
 *       expectedVersion,
 *       event.version,
 *       event.aggregateType,
 *       event.aggregateId
 *     );
 *   }
 *
 *   await eventStore.append(event);
 * }
 * ```
 */
export class VersionConflictError extends CevesError {
  /**
   * Create a version conflict error.
   *
   * Returns HTTP 409 Conflict status.
   *
   * @param message - Human-readable error description
   * @param expectedVersion - The version that was expected
   * @param actualVersion - The version that was provided
   * @param aggregateType - Optional aggregate type
   * @param aggregateId - Optional aggregate instance ID
   */
  constructor(
    message: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
    aggregateType?: string,
    aggregateId?: string
  ) {
    super(message, 409, aggregateType, aggregateId);
  }

  /**
   * Serialize error to JSON with version conflict details.
   */
  override toJSON() {
    return {
      ...super.toJSON(),
      expectedVersion: this.expectedVersion,
      actualVersion: this.actualVersion,
    };
  }

  /**
   * Reconstruct VersionConflictError from JSON.
   */
  static override fromJSON(json: VersionConflictErrorJSON): VersionConflictError {
    const error = new VersionConflictError(json.message, json.expectedVersion, json.actualVersion, json.aggregateType, json.aggregateId);

    if (json.stack) {
      error.stack = json.stack;
    }

    return error;
  }
}
