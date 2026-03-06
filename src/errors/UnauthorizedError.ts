/**
 * UnauthorizedError - 401 Unauthorized
 *
 * Thrown when authentication credentials are missing or invalid.
 * Use this when the request lacks proper authentication (no token, expired token, etc.).
 */

import { CevesError } from './CevesError';

/**
 * Error thrown when authentication is missing or invalid.
 *
 * @example
 * ```typescript
 * if (!request.headers.get('Authorization')) {
 *   throw new UnauthorizedError('Missing authentication token');
 * }
 * ```
 */
export class UnauthorizedError extends CevesError {
  constructor(message: string = 'Unauthorized', aggregateType?: string, aggregateId?: string) {
    super(message, 401, aggregateType, aggregateId);
  }
}
