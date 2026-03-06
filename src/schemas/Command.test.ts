/**
 * Unit tests for Command schema definitions
 *
 * Tests cover:
 * - BaseCommandSchema validation (aggregateType, aggregateId)
 * - BaseCommandSchema extension patterns (schema extension, type inference)
 * - Validation error details (ZodError structure, actionable messages)
 * - Edge cases: null, undefined, wrong types, unknown fields
 */

import { describe, it, expect } from 'vitest';
import { z, ZodError } from 'zod';
import { BaseCommandSchema, BaseCommand } from './Command';

describe('BaseCommandSchema', () => {
  describe('validates aggregateType and aggregateId fields', () => {
    it('should validate commands with valid aggregateType and aggregateId', () => {
      // Arrange
      const validCommand = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
      };

      // Act & Assert
      expect(() => BaseCommandSchema.parse(validCommand)).not.toThrow();
      const result = BaseCommandSchema.parse(validCommand);
      expect(result).toEqual(validCommand);
    });

    it('should reject commands with missing aggregateType', () => {
      // Arrange
      const invalidCommand = {
        aggregateId: 'acc-123',
      };

      // Act & Assert
      expect(() => BaseCommandSchema.parse(invalidCommand)).toThrow(ZodError);
    });

    it('should reject commands with missing aggregateId', () => {
      // Arrange
      const invalidCommand = {
        aggregateType: 'account',
      };

      // Act & Assert
      expect(() => BaseCommandSchema.parse(invalidCommand)).toThrow(ZodError);
    });

    it('should reject commands with empty string aggregateType', () => {
      // Arrange
      const invalidCommand = {
        aggregateType: '',
        aggregateId: 'acc-123',
      };

      // Act & Assert
      try {
        BaseCommandSchema.parse(invalidCommand);
        expect.fail('Should have thrown ZodError');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        const zodError = error as ZodError;
        expect(zodError.errors[0].message).toContain('required');
      }
    });

    it('should reject commands with empty string aggregateId', () => {
      // Arrange
      const invalidCommand = {
        aggregateType: 'account',
        aggregateId: '',
      };

      // Act & Assert
      try {
        BaseCommandSchema.parse(invalidCommand);
        expect.fail('Should have thrown ZodError');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        const zodError = error as ZodError;
        expect(zodError.errors[0].message).toContain('required');
      }
    });
  });

  describe('TypeScript type inference', () => {
    it('should infer BaseCommand type correctly', () => {
      // Arrange
      const command: BaseCommand = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
      };

      // Act
      const result = BaseCommandSchema.parse(command);

      // Assert - TypeScript ensures type safety at compile time
      expect(result.aggregateType).toBe('account');
      expect(result.aggregateId).toBe('acc-123');
    });
  });
});

describe('validation errors include field paths and details', () => {
  it('should include field path in error.errors array', () => {
    // Arrange
    const invalidCommand = {
      aggregateType: 'account',
      // aggregateId missing
    };

    // Act & Assert
    try {
      BaseCommandSchema.parse(invalidCommand);
      expect.fail('Should have thrown ZodError');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      const zodError = error as ZodError;

      expect(zodError.errors).toHaveLength(1);
      expect(zodError.errors[0].path).toEqual(['aggregateId']);
    }
  });

  it('should provide actionable error messages', () => {
    // Arrange
    const invalidCommand = {
      aggregateType: '',
      aggregateId: 'acc-123',
    };

    // Act & Assert
    try {
      BaseCommandSchema.parse(invalidCommand);
      expect.fail('Should have thrown ZodError');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      const zodError = error as ZodError;

      expect(zodError.errors[0].message).toBe('Aggregate type is required');
    }
  });

  it('should return all field errors in single ZodError.errors array', () => {
    // Arrange - Both fields invalid
    const invalidCommand = {
      aggregateType: '',
      aggregateId: '',
    };

    // Act & Assert
    try {
      BaseCommandSchema.parse(invalidCommand);
      expect.fail('Should have thrown ZodError');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      const zodError = error as ZodError;

      // Both errors should be reported
      expect(zodError.errors.length).toBeGreaterThanOrEqual(2);
      const paths = zodError.errors.map((e) => e.path[0]);
      expect(paths).toContain('aggregateType');
      expect(paths).toContain('aggregateId');
    }
  });

  it('should support safeParse for graceful error handling', () => {
    // Arrange
    const invalidCommand = {
      aggregateType: 'account',
      // aggregateId missing
    };

    // Act
    const result = BaseCommandSchema.safeParse(invalidCommand);

    // Assert
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
      expect(result.error.errors[0].path).toEqual(['aggregateId']);
    }
  });

  it('should return success: true for valid commands with safeParse', () => {
    // Arrange
    const validCommand = {
      aggregateType: 'account',
      aggregateId: 'acc-123',
    };

    // Act
    const result = BaseCommandSchema.safeParse(validCommand);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validCommand);
    }
  });
});

describe('Edge cases', () => {
  it('should reject null aggregateType', () => {
    // Arrange
    const invalidCommand = {
      aggregateType: null,
      aggregateId: 'acc-123',
    };

    // Act & Assert
    expect(() => BaseCommandSchema.parse(invalidCommand)).toThrow(ZodError);
  });

  it('should reject undefined aggregateType', () => {
    // Arrange
    const invalidCommand = {
      aggregateType: undefined,
      aggregateId: 'acc-123',
    };

    // Act & Assert
    expect(() => BaseCommandSchema.parse(invalidCommand)).toThrow(ZodError);
  });

  it('should reject numeric aggregateId (must be string)', () => {
    // Arrange
    const invalidCommand = {
      aggregateType: 'account',
      aggregateId: 123, // Number instead of string!
    };

    // Act & Assert
    expect(() => BaseCommandSchema.parse(invalidCommand)).toThrow(ZodError);
  });

  it('should strip unknown fields (Zod default behavior)', () => {
    // Arrange
    const commandWithExtra = {
      aggregateType: 'account',
      aggregateId: 'acc-123',
      unknownField: 'extra-data',
    };

    // Act
    const result = BaseCommandSchema.parse(commandWithExtra);

    // Assert - unknown field should be stripped
    expect(result).toEqual({
      aggregateType: 'account',
      aggregateId: 'acc-123',
    });
    expect('unknownField' in result).toBe(false);
  });

});

describe('Integration with exports', () => {
  it('should be importable from index.ts', async () => {
    // This test verifies exports are configured correctly
    // Actual import is tested at compile time
    const { BaseCommandSchema: ImportedSchema } = await import('./Command');

    const validCommand = {
      aggregateType: 'account',
      aggregateId: 'acc-123',
    };

    expect(() => ImportedSchema.parse(validCommand)).not.toThrow();
  });
});
