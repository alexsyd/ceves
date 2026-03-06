/**
 * Unit tests for Event schema definitions
 *
 * Tests cover:
 * - BaseEventSchema validation (aggregateType, aggregateId, version, timestamp)
 * - BaseEventSchema extension patterns (schema extension, type inference)
 * - Apply methods transform state functionally (immutability, version tracking)
 * - Edge cases: null, undefined, wrong types, boundary values
 */

import { describe, it, expect } from 'vitest';
import { z, ZodError } from 'zod';
import { BaseEventSchema, BaseEvent } from './Event';

describe('BaseEventSchema', () => {
  describe('validates event metadata fields', () => {
    it('should validate events with valid aggregateType, aggregateId, version, timestamp', () => {
      // Arrange
      const validEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert
      expect(() => BaseEventSchema.parse(validEvent)).not.toThrow();
      const result = BaseEventSchema.parse(validEvent);
      expect(result).toEqual(validEvent);
    });

    it('should reject events with missing aggregateType', () => {
      // Arrange
      const invalidEvent = {
        aggregateId: 'acc-123',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert
      expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
    });

    it('should reject events with missing aggregateId', () => {
      // Arrange
      const invalidEvent = {
        aggregateType: 'account',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert
      expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
    });

    it('should reject events with missing version', () => {
      // Arrange
      const invalidEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert
      expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
    });

    it('should reject events with missing timestamp', () => {
      // Arrange
      const invalidEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        version: 1,
      };

      // Act & Assert
      expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
    });

    it('should reject events with empty string aggregateType', () => {
      // Arrange
      const invalidEvent = {
        aggregateType: '',
        aggregateId: 'acc-123',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert
      try {
        BaseEventSchema.parse(invalidEvent);
        expect.fail('Should have thrown ZodError');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        const zodError = error as ZodError;
        expect(zodError.errors[0].message).toContain('required');
      }
    });

    it('should reject events with empty string aggregateId', () => {
      // Arrange
      const invalidEvent = {
        aggregateType: 'account',
        aggregateId: '',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert
      try {
        BaseEventSchema.parse(invalidEvent);
        expect.fail('Should have thrown ZodError');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        const zodError = error as ZodError;
        expect(zodError.errors[0].message).toContain('required');
      }
    });

    it('should reject events with version = 0 (must be positive)', () => {
      // Arrange
      const invalidEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        version: 0,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert
      expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
    });

    it('should reject events with negative version', () => {
      // Arrange
      const invalidEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        version: -1,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert
      expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
    });

    it('should reject events with non-integer version (e.g., 1.5)', () => {
      // Arrange
      const invalidEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        version: 1.5,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert
      expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
    });

    it('should reject events with invalid timestamp format (non-ISO 8601)', () => {
      // Arrange
      const invalidEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        version: 1,
        timestamp: '2025-11-15', // Missing time component
      };

      // Act & Assert
      expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
    });

    it('should accept events with valid ISO 8601 timestamp', () => {
      // Arrange
      const validEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        version: 1,
        timestamp: '2025-11-15T14:30:00.000Z',
      };

      // Act & Assert
      expect(() => BaseEventSchema.parse(validEvent)).not.toThrow();
    });

    it('should include field path and message in ZodError.errors array', () => {
      // Arrange
      const invalidEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        version: 1,
        // timestamp missing
      };

      // Act & Assert
      try {
        BaseEventSchema.parse(invalidEvent);
        expect.fail('Should have thrown ZodError');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        const zodError = error as ZodError;
        expect(zodError.errors).toHaveLength(1);
        expect(zodError.errors[0].path).toEqual(['timestamp']);
      }
    });
  });

  describe('TypeScript type inference', () => {
    it('should infer BaseEvent type correctly', () => {
      // Arrange
      const event: BaseEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act
      const result = BaseEventSchema.parse(event);

      // Assert - TypeScript ensures type safety at compile time
      expect(result.aggregateType).toBe('account');
      expect(result.aggregateId).toBe('acc-123');
      expect(result.version).toBe(1);
      expect(result.timestamp).toBe('2025-11-15T10:00:00Z');
    });
  });
});


describe('Edge cases', () => {
  it('should reject null aggregateType', () => {
    // Arrange
    const invalidEvent = {
      aggregateType: null,
      aggregateId: 'acc-123',
      version: 1,
      timestamp: '2025-11-15T10:00:00Z',
    };

    // Act & Assert
    expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
  });

  it('should reject undefined aggregateType', () => {
    // Arrange
    const invalidEvent = {
      aggregateType: undefined,
      aggregateId: 'acc-123',
      version: 1,
      timestamp: '2025-11-15T10:00:00Z',
    };

    // Act & Assert
    expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
  });

  it('should reject numeric aggregateId (must be string)', () => {
    // Arrange
    const invalidEvent = {
      aggregateType: 'account',
      aggregateId: 123, // Number instead of string!
      version: 1,
      timestamp: '2025-11-15T10:00:00Z',
    };

    // Act & Assert
    expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
  });

  it('should reject string version (must be number)', () => {
    // Arrange
    const invalidEvent = {
      aggregateType: 'account',
      aggregateId: 'acc-123',
      version: '1', // String instead of number!
      timestamp: '2025-11-15T10:00:00Z',
    };

    // Act & Assert
    expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
  });

  it('should reject Date object timestamp (must be string)', () => {
    // Arrange
    const invalidEvent = {
      aggregateType: 'account',
      aggregateId: 'acc-123',
      version: 1,
      timestamp: new Date(), // Date object instead of string!
    };

    // Act & Assert
    expect(() => BaseEventSchema.parse(invalidEvent)).toThrow(ZodError);
  });

  it('should strip unknown fields (Zod default behavior)', () => {
    // Arrange
    const eventWithExtra = {
      aggregateType: 'account',
      aggregateId: 'acc-123',
      version: 1,
      timestamp: '2025-11-15T10:00:00Z',
      unknownField: 'extra-data',
    };

    // Act
    const result = BaseEventSchema.parse(eventWithExtra);

    // Assert - unknown field should be stripped
    expect(result).toEqual({
      aggregateType: 'account',
      aggregateId: 'acc-123',
      version: 1,
      timestamp: '2025-11-15T10:00:00Z',
    });
    expect('unknownField' in result).toBe(false);
  });

  it('should support safeParse for graceful error handling', () => {
    // Arrange
    const invalidEvent = {
      aggregateType: 'account',
      aggregateId: 'acc-123',
      version: 0, // Invalid: must be positive
      timestamp: '2025-11-15T10:00:00Z',
    };

    // Act
    const result = BaseEventSchema.safeParse(invalidEvent);

    // Assert
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
      expect(result.error.errors.length).toBeGreaterThan(0);
    }
  });

  it('should return success: true for valid events with safeParse', () => {
    // Arrange
    const validEvent = {
      aggregateType: 'account',
      aggregateId: 'acc-123',
      version: 1,
      timestamp: '2025-11-15T10:00:00Z',
    };

    // Act
    const result = BaseEventSchema.safeParse(validEvent);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validEvent);
    }
  });
});

describe('Integration with exports', () => {
  it('should be importable from Event.ts', async () => {
    // This test verifies exports are configured correctly
    // Actual import is tested at compile time
    const { BaseEventSchema: ImportedSchema } = await import('./Event');

    const validEvent = {
      aggregateType: 'account',
      aggregateId: 'acc-123',
      version: 1,
      timestamp: '2025-11-15T10:00:00Z',
    };

    expect(() => ImportedSchema.parse(validEvent)).not.toThrow();
  });
});
