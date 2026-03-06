/**
 * ForbiddenError - 403 Forbidden
 *
 * Thrown when authentication succeeded but the user lacks permission for the requested resource.
 * Use this when credentials are valid but the user is not authorized to perform the action.
 */

import { CevesError } from './CevesError';

/**
 * Error thrown when user lacks permission for the requested resource.
 *
 * @example
 * ```typescript
 * if (this.state?.ownerId !== userId) {
 *   throw new ForbiddenError('User does not own this resource');
 * }
 * ```
 */
export class ForbiddenError extends CevesError {
  constructor(message: string = 'Forbidden', aggregateType?: string, aggregateId?: string) {
    super(message, 403, aggregateType, aggregateId);
  }
}
