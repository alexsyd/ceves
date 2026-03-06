/**
 * Base Error Class for Ceves Event Sourcing Library
 */

import { ApiException } from 'chanfana';

/**
 * V8 Error interface extension for captureStackTrace
 * Declared separately to avoid conflicts with @types/node
 */
interface V8Error {
  captureStackTrace?(targetObject: object, constructorOpt?: NewableFunction): void;
}

/**
 * JSON representation of CevesError for serialization/deserialization
 * Exported so subclasses can extend it for their own fromJSON() methods
 */
export interface CevesErrorJSON {
  name?: string;
  message: string;
  stack?: string;
  httpStatusCode?: number;
  aggregateType?: string;
  aggregateId?: string;
}

/**
 * Base error class for all Ceves library errors.
 *
 * All library-specific errors should extend this class to enable:
 * - Consistent error handling across the library
 * - Type-safe error catching with instanceof
 * - Proper error name reporting
 * - HTTP status code propagation for API responses
 * - Additional context (aggregateType, aggregateId) for event sourcing scenarios
 * - Automatic OpenAPI error documentation via chanfana integration
 *
 * This class extends chanfana's ApiException to leverage:
 * - Standardized error response format: { success: false, errors: [{ code, message }] }
 * - Automatic HTTP status code handling
 * - OpenAPI schema generation for error responses
 *
 * @example
 * ```typescript
 * // Create a domain-specific error class
 * class NotFoundError extends CevesError {
 *   constructor(message: string, aggregateType?: string, aggregateId?: string) {
 *     super(message, 404, aggregateType, aggregateId);
 *   }
 * }
 *
 * // Use the error in business logic
 * try {
 *   throw new NotFoundError('Account not found', 'account', 'acc-123');
 * } catch (error) {
 *   if (error instanceof CevesError) {
 *     console.error('Ceves error:', error.message);
 *     console.error('HTTP status:', error.httpStatusCode);
 *   }
 * }
 * ```
 */
export class CevesError extends ApiException {
  /**
   * HTTP status code for this error.
   * Defaults to 400 (Bad Request) for business/validation errors.
   */
  public readonly httpStatusCode: number;

  /**
   * Type of aggregate involved in the error (optional).
   * Useful for event sourcing context and debugging.
   */
  public readonly aggregateType?: string;

  /**
   * ID of aggregate instance involved in the error (optional).
   * Useful for event sourcing context and debugging.
   */
  public readonly aggregateId?: string;

  /**
   * Create a new CevesError.
   *
   * @param message - Human-readable error description
   * @param httpStatusCode - HTTP status code (default: 400 Bad Request)
   * @param aggregateType - Optional aggregate type for event sourcing context
   * @param aggregateId - Optional aggregate instance ID for event sourcing context
   */
  constructor(
    message: string,
    httpStatusCode: number = 400,
    aggregateType?: string,
    aggregateId?: string
  ) {
    super(message);

    // Set prototype explicitly for proper instanceof checks in TypeScript
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = this.constructor.name;
    this.httpStatusCode = httpStatusCode;
    this.status = httpStatusCode; // Set ApiException's status property
    this.code = httpStatusCode; // Set ApiException's code property
    this.aggregateType = aggregateType;
    this.aggregateId = aggregateId;

    // Maintains proper stack trace for where error was thrown (V8 only)
    const V8ErrorConstructor = Error as unknown as V8Error;
    if (V8ErrorConstructor.captureStackTrace) {
      V8ErrorConstructor.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Build error response in chanfana's standard format.
   *
   * Returns an array with a single error object containing the HTTP status code
   * and error message. This format is used by chanfana for consistent API error responses.
   *
   * @returns Array of error objects in chanfana format
   */
  override buildResponse(): { code: number; message: string }[] {
    return [
      {
        code: this.httpStatusCode,
        message: this.message,
      },
    ];
  }

  /**
   * Get OpenAPI schema for error responses.
   *
   * Returns the standard chanfana error response schema that can be spread
   * into handler metadata for automatic OpenAPI documentation.
   *
   * @example
   * ```typescript
   * export const myHandlerMetadata = {
   *   responses: {
   *     200: { description: 'Success' },
   *     ...CevesError.schema(), // Adds error response schemas
   *   }
   * };
   * ```
   *
   * @returns OpenAPI schema definition for error responses
   */
  static override schema() {
    return ApiException.schema();
  }

  /**
   * Serialize error to JSON with all fields.
   *
   * Useful for logging, transmission, and storage of error information.
   * Includes event sourcing context fields and HTTP status code.
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      stack: this.stack,
      httpStatusCode: this.httpStatusCode,
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
    };
  }

  /**
   * Reconstruct CevesError from JSON.
   *
   * Note: Subclasses should override this method to reconstruct their specific type.
   *
   * @param json - JSON representation of the error
   */
  static fromJSON(json: CevesErrorJSON): CevesError {
    const error = new CevesError(json.message, json.httpStatusCode, json.aggregateType, json.aggregateId);

    if (json.stack) {
      error.stack = json.stack;
    }

    return error;
  }
}
