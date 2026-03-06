/**
 * Command Validation Error for Ceves Event Sourcing Library
 */

import { CevesError, CevesErrorJSON } from './CevesError';

/**
 * JSON representation of CommandValidationError
 */
interface CommandValidationErrorJSON extends CevesErrorJSON {
  commandType: string;
  validationErrors: unknown[];
}

/**
 * Error thrown when command validation fails.
 *
 * This error is typically thrown when a command's payload fails Zod schema
 * validation or business rule validation before being processed.
 * Returns HTTP 400 Bad Request responses.
 *
 * @example
 * ```typescript
 * import { CommandValidationError } from './CommandValidationError';
 * import { z } from 'zod';
 *
 * const CreateAccountSchema = z.object({
 *   email: z.string().email(),
 *   age: z.number().positive(),
 * });
 *
 * try {
 *   CreateAccountSchema.parse({ email: 'invalid', age: -5 });
 * } catch (zodError) {
 *   throw new CommandValidationError(
 *     'Command validation failed',
 *     'CreateAccount',
 *     zodError.errors,
 *     'account'
 *   );
 * }
 * ```
 */
export class CommandValidationError extends CevesError {
  /**
   * Create a command validation error.
   *
   * @param message - Human-readable error description
   * @param commandType - Type of command that failed validation
   * @param validationErrors - Array of validation errors (typically from Zod)
   * @param aggregateType - Optional aggregate type
   * @param aggregateId - Optional aggregate instance ID
   */
  constructor(
    message: string,
    public readonly commandType: string,
    public readonly validationErrors: unknown[],
    aggregateType?: string,
    aggregateId?: string
  ) {
    super(message, 400, aggregateType, aggregateId);
  }

  /**
   * Serialize error to JSON with validation details.
   */
  override toJSON() {
    return {
      ...super.toJSON(),
      commandType: this.commandType,
      validationErrors: this.validationErrors,
    };
  }

  /**
   * Reconstruct CommandValidationError from JSON.
   */
  static override fromJSON(json: CommandValidationErrorJSON): CommandValidationError {
    const error = new CommandValidationError(json.message, json.commandType, json.validationErrors, json.aggregateType, json.aggregateId);

    if (json.stack) {
      error.stack = json.stack;
    }

    return error;
  }
}
