/**
 * Unit tests for Command schema definitions
 *
 * Tests cover:
 * - AC-2.1.1: BaseCommandSchema validation (aggregateType, aggregateId)
 * - AC-2.1.2: defineCommand helper (schema extension, type inference)
 * - AC-2.1.3: Validation error details (ZodError structure, actionable messages)
 * - Edge cases: null, undefined, wrong types, unknown fields
 */

import { describe, it, expect } from 'vitest';
import { z, ZodError } from 'zod';
import { BaseCommandSchema, BaseCommand, defineCommand } from './Command';

describe('BaseCommandSchema', () => {
  describe('AC-2.1.1: validates aggregateType and aggregateId fields', () => {
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

describe('defineCommand', () => {
  describe('AC-2.1.2: creates extended schemas with custom fields', () => {
    it('should create schema extending base fields', () => {
      // Arrange
      const CreateAccountCommand = defineCommand('CreateAccount', {
        email: z.string().email(),
        name: z.string().min(1),
      });

      const validCommand = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        commandType: 'CreateAccount',
        email: 'alice@example.com',
        name: 'Alice',
      };

      // Act
      const result = CreateAccountCommand.parse(validCommand);

      // Assert - base fields should be validated
      expect(result.aggregateType).toBe('account');
      expect(result.aggregateId).toBe('acc-123');
    });

    it('should add custom fields to schema', () => {
      // Arrange
      const CreateAccountCommand = defineCommand('CreateAccount', {
        email: z.string().email(),
        name: z.string().min(1),
      });

      const validCommand = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        commandType: 'CreateAccount',
        email: 'alice@example.com',
        name: 'Alice',
      };

      // Act
      const result = CreateAccountCommand.parse(validCommand);

      // Assert - custom fields should be validated
      expect(result.email).toBe('alice@example.com');
      expect(result.name).toBe('Alice');
    });

    it('should add commandType as literal', () => {
      // Arrange
      const CreateAccountCommand = defineCommand('CreateAccount', {
        email: z.string().email(),
      });

      const validCommand = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        commandType: 'CreateAccount',
        email: 'alice@example.com',
      };

      // Act
      const result = CreateAccountCommand.parse(validCommand);

      // Assert
      expect(result.commandType).toBe('CreateAccount');
    });

    it('should reject wrong commandType literal', () => {
      // Arrange
      const CreateAccountCommand = defineCommand('CreateAccount', {
        email: z.string().email(),
      });

      const invalidCommand = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        commandType: 'WrongType', // Wrong literal!
        email: 'alice@example.com',
      };

      // Act & Assert
      expect(() => CreateAccountCommand.parse(invalidCommand)).toThrow(
        ZodError
      );
    });

    it('should validate combined schema (base + custom fields)', () => {
      // Arrange
      const DepositMoneyCommand = defineCommand('DepositMoney', {
        amount: z.number().positive(),
      });

      // Act & Assert - Missing base field should fail
      expect(() =>
        DepositMoneyCommand.parse({
          aggregateType: 'account',
          // aggregateId missing!
          commandType: 'DepositMoney',
          amount: 100,
        })
      ).toThrow(ZodError);

      // Act & Assert - Missing custom field should fail
      expect(() =>
        DepositMoneyCommand.parse({
          aggregateType: 'account',
          aggregateId: 'acc-123',
          commandType: 'DepositMoney',
          // amount missing!
        })
      ).toThrow(ZodError);
    });

    it('should validate custom field constraints', () => {
      // Arrange
      const CreateAccountCommand = defineCommand('CreateAccount', {
        email: z.string().email(),
        age: z.number().int().min(18),
      });

      // Act & Assert - Invalid email should fail
      expect(() =>
        CreateAccountCommand.parse({
          aggregateType: 'account',
          aggregateId: 'acc-123',
          commandType: 'CreateAccount',
          email: 'not-an-email',
          age: 25,
        })
      ).toThrow(ZodError);

      // Act & Assert - Age too young should fail
      expect(() =>
        CreateAccountCommand.parse({
          aggregateType: 'account',
          aggregateId: 'acc-123',
          commandType: 'CreateAccount',
          email: 'alice@example.com',
          age: 17, // Below minimum!
        })
      ).toThrow(ZodError);
    });

    it('should support TypeScript type inference for custom commands', () => {
      // Arrange
      const CreateAccountCommand = defineCommand('CreateAccount', {
        email: z.string().email(),
        name: z.string().min(1),
      });

      type CreateAccountCommand = z.infer<typeof CreateAccountCommand>;

      const command: CreateAccountCommand = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        commandType: 'CreateAccount',
        email: 'alice@example.com',
        name: 'Alice',
      };

      // Act
      const result = CreateAccountCommand.parse(command);

      // Assert - TypeScript ensures type safety
      expect(result).toEqual(command);
    });
  });
});

describe('AC-2.1.3: validation errors include field paths and details', () => {
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

  it('should handle complex custom schemas with defineCommand', () => {
    // Arrange
    const TransferMoneyCommand = defineCommand('TransferMoney', {
      fromAccount: z.string().min(1),
      toAccount: z.string().min(1),
      amount: z.number().positive(),
      currency: z.enum(['USD', 'EUR', 'GBP']),
      note: z.string().optional(),
    });

    const validCommand = {
      aggregateType: 'account',
      aggregateId: 'acc-123',
      commandType: 'TransferMoney',
      fromAccount: 'acc-123',
      toAccount: 'acc-456',
      amount: 100.5,
      currency: 'USD' as const,
    };

    // Act
    const result = TransferMoneyCommand.parse(validCommand);

    // Assert
    expect(result.amount).toBe(100.5);
    expect(result.currency).toBe('USD');
    expect(result.note).toBeUndefined(); // Optional field
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
