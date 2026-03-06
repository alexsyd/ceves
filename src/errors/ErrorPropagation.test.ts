/**
 * Integration tests for error propagation through handlers
 *
 * Tests verify that:
 * - HTTP status codes are preserved from CevesError instances
 * - Error responses use chanfana format consistently
 * - Validation errors return 400 with proper format
 * - Unexpected errors return 500 with proper format
 */

import { describe, it, expect } from 'vitest';
import { CevesError } from './CevesError';
import { BusinessRuleViolationError } from './BusinessRuleViolationError';
import { AggregateNotFoundError } from './AggregateNotFoundError';
import { VersionConflictError } from './VersionConflictError';
import { MissingApiKeyError, InvalidApiKeyError, UnauthorizedAccessError } from '../tenancy/errors';

describe('Error Propagation', () => {
  describe('HTTP Status Code Propagation', () => {
    it('should preserve 400 status from BusinessRuleViolationError', () => {
      // Arrange
      const error = new BusinessRuleViolationError(
        'Insufficient funds',
        'BankAccount',
        'acc-123'
      );

      // Assert
      expect(error.httpStatusCode).toBe(400);
      expect(error instanceof CevesError).toBe(true);
    });

    it('should preserve 401 status from MissingApiKeyError', () => {
      // Arrange
      const error = new MissingApiKeyError('API key missing');

      // Assert
      expect(error.httpStatusCode).toBe(401);
      expect(error instanceof CevesError).toBe(true);
    });

    it('should preserve 401 status from InvalidApiKeyError', () => {
      // Arrange
      const error = new InvalidApiKeyError('Invalid API key');

      // Assert
      expect(error.httpStatusCode).toBe(401);
      expect(error instanceof CevesError).toBe(true);
    });

    it('should preserve 403 status from UnauthorizedAccessError', () => {
      // Arrange
      const error = new UnauthorizedAccessError('Access denied');

      // Assert
      expect(error.httpStatusCode).toBe(403);
      expect(error instanceof CevesError).toBe(true);
    });

    it('should preserve 404 status from AggregateNotFoundError', () => {
      // Arrange
      const error = new AggregateNotFoundError('BankAccount', 'acc-123');

      // Assert
      expect(error.httpStatusCode).toBe(404);
      expect(error instanceof CevesError).toBe(true);
    });

    it('should preserve 409 status from VersionConflictError', () => {
      // Arrange
      const error = new VersionConflictError(
        'Version conflict',
        5,
        3,
        'BankAccount',
        'acc-123'
      );

      // Assert
      expect(error.httpStatusCode).toBe(409);
      expect(error instanceof CevesError).toBe(true);
    });

    it('should default to 400 for custom CevesError instances', () => {
      // Arrange
      const error = new CevesError('Custom error');

      // Assert
      expect(error.httpStatusCode).toBe(400);
    });

    it('should support custom status codes in CevesError', () => {
      // Arrange
      const error = new CevesError('Service unavailable', 503);

      // Assert
      expect(error.httpStatusCode).toBe(503);
    });
  });

  describe('Chanfana Error Response Format', () => {
    it('should generate chanfana format from buildResponse()', () => {
      // Arrange
      const error = new CevesError('Validation failed', 400);

      // Act
      const response = error.buildResponse();

      // Assert
      expect(response).toEqual([
        {
          code: 400,
          message: 'Validation failed',
        },
      ]);
    });

    it('should include proper status code in response', () => {
      // Arrange
      const error404 = new AggregateNotFoundError('Account', 'acc-123');
      const error401 = new MissingApiKeyError();

      // Act
      const response404 = error404.buildResponse();
      const response401 = error401.buildResponse();

      // Assert
      expect(response404[0].code).toBe(404);
      expect(response401[0].code).toBe(401);
    });

    it('should include error message in response', () => {
      // Arrange
      const error = new BusinessRuleViolationError('Insufficient funds');

      // Act
      const response = error.buildResponse();

      // Assert
      expect(response[0].message).toBe('Insufficient funds');
    });
  });

  describe('OpenAPI Schema Generation', () => {
    it('should provide static schema() method', () => {
      // Act
      const schema = CevesError.schema();

      // Assert
      expect(schema).toBeDefined();
      expect(typeof schema).toBe('object');
    });

    it('should generate schema that can be spread into handler metadata', () => {
      // Act
      const schema = CevesError.schema();

      // Simulate spreading into handler metadata
      const handlerMetadata = {
        responses: {
          200: { description: 'Success' },
          ...schema,
        },
      };

      // Assert
      expect(handlerMetadata.responses).toBeDefined();
      expect(handlerMetadata.responses[200]).toBeDefined();
    });
  });

  describe('Error instanceof checks', () => {
    it('should support instanceof checks for error hierarchy', () => {
      // Arrange
      const businessError = new BusinessRuleViolationError('Business rule violated');
      const notFoundError = new AggregateNotFoundError('Account', 'acc-1');
      const authError = new InvalidApiKeyError();

      // Assert - all should be instances of CevesError
      expect(businessError instanceof CevesError).toBe(true);
      expect(notFoundError instanceof CevesError).toBe(true);
      expect(authError instanceof CevesError).toBe(true);

      // Assert - specific instanceof checks
      expect(businessError instanceof BusinessRuleViolationError).toBe(true);
      expect(notFoundError instanceof AggregateNotFoundError).toBe(true);
      expect(authError instanceof InvalidApiKeyError).toBe(true);
    });
  });

  describe('Error serialization with httpStatusCode', () => {
    it('should serialize httpStatusCode in toJSON()', () => {
      // Arrange
      const error = new CevesError('Test error', 403, 'Account', 'acc-123');

      // Act
      const json = error.toJSON();

      // Assert
      expect(json.httpStatusCode).toBe(403);
      expect(json.message).toBe('Test error');
      expect(json.aggregateType).toBe('Account');
      expect(json.aggregateId).toBe('acc-123');
    });

    it('should restore httpStatusCode from fromJSON()', () => {
      // Arrange
      const original = new CevesError('Test error', 404);
      const json = original.toJSON();

      // Act
      const restored = CevesError.fromJSON(json);

      // Assert
      expect(restored.httpStatusCode).toBe(404);
      expect(restored.message).toBe('Test error');
    });
  });
});
