/**
 * Business Rule Violation Error
 *
 * Thrown when a command violates domain business rules.
 * Returns HTTP 400 Bad Request responses.
 */

import { CevesError } from './CevesError';

/**
 * Error thrown when a command violates business rules.
 *
 * Examples:
 * - Withdrawing more than available balance
 * - Opening an account that already exists
 * - Performing an operation on non-existent aggregate
 *
 * This error type signals that the request was invalid according to
 * business logic (not a server error), and returns HTTP 400 Bad Request.
 */
export class BusinessRuleViolationError extends CevesError {
  constructor(
    message: string,
    aggregateType?: string,
    aggregateId?: string
  ) {
    super(message, 400, aggregateType, aggregateId);
  }
}
