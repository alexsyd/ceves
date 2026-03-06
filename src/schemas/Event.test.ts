/**
 * Unit tests for Event schema definitions
 *
 * Tests cover:
 * - AC-2.2.1: BaseEventSchema validation (aggregateType, aggregateId, version, timestamp)
 * - AC-2.2.2: defineEvent helper (schema extension, apply method enforcement, type inference)
 * - AC-2.2.3: Apply methods transform state functionally (immutability, version tracking)
 * - Edge cases: null, undefined, wrong types, boundary values
 */

import { describe, it, expect } from 'vitest';
import { z, ZodError } from 'zod';
import { BaseEventSchema, BaseEvent, defineEvent } from './Event';

describe('BaseEventSchema', () => {
  describe('AC-2.2.1: validates event metadata fields', () => {
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

describe('defineEvent', () => {
  describe('AC-2.2.2: enforces apply method implementation', () => {
    it('should return object with schema, apply, and eventType properties', () => {
      // Arrange & Act
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
          name: z.string(),
        }),
        (state, event) => ({
          id: event.aggregateId,
          email: event.email,
          name: event.name,
          balance: 0,
          version: event.version,
          createdAt: event.timestamp,
        })
      );

      // Assert
      expect(AccountCreatedEvent).toHaveProperty('schema');
      expect(AccountCreatedEvent).toHaveProperty('apply');
      expect(AccountCreatedEvent).toHaveProperty('eventType');
    });

    it('should set eventType property to match input string', () => {
      // Arrange & Act
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
        }),
        (state, event) => ({ id: event.aggregateId, version: event.version })
      );

      // Assert
      expect(AccountCreatedEvent.eventType).toBe('AccountCreated');
    });

    it('should extend base schema with custom data fields', () => {
      // Arrange
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
          name: z.string(),
        }),
        (state, event) => ({
          id: event.aggregateId,
          email: event.email,
          name: event.name,
          version: event.version,
        })
      );

      const validEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'AccountCreated',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'alice@example.com',
        name: 'Alice',
      };

      // Act
      const result = AccountCreatedEvent.schema.parse(validEvent);

      // Assert - custom fields should be validated
      expect(result.email).toBe('alice@example.com');
      expect(result.name).toBe('Alice');
    });

    it('should add type as literal', () => {
      // Arrange
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
        }),
        (state, event) => ({ id: event.aggregateId, version: event.version })
      );

      const validEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'AccountCreated',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'alice@example.com',
      };

      // Act
      const result = AccountCreatedEvent.schema.parse(validEvent);

      // Assert
      expect(result.type).toBe('AccountCreated');
    });

    it('should reject wrong type literal', () => {
      // Arrange
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
        }),
        (state, event) => ({ id: event.aggregateId, version: event.version })
      );

      const invalidEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'WrongType', // Wrong literal!
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'alice@example.com',
      };

      // Act & Assert
      expect(() => AccountCreatedEvent.schema.parse(invalidEvent)).toThrow(
        ZodError
      );
    });

    it('should validate custom data fields correctly (e.g., email validation)', () => {
      // Arrange
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
          age: z.number().int().min(18),
        }),
        (state, event) => ({ id: event.aggregateId, version: event.version })
      );

      // Act & Assert - Invalid email should fail
      expect(() =>
        AccountCreatedEvent.schema.parse({
          aggregateType: 'account',
          aggregateId: 'acc-123',
          type: 'AccountCreated',
          version: 1,
          timestamp: '2025-11-15T10:00:00Z',
          email: 'not-an-email',
          age: 25,
        })
      ).toThrow(ZodError);

      // Act & Assert - Age too young should fail
      expect(() =>
        AccountCreatedEvent.schema.parse({
          aggregateType: 'account',
          aggregateId: 'acc-123',
          type: 'AccountCreated',
          version: 1,
          timestamp: '2025-11-15T10:00:00Z',
          email: 'alice@example.com',
          age: 17, // Below minimum!
        })
      ).toThrow(ZodError);
    });

    it('should validate both base and custom fields in combined schema', () => {
      // Arrange
      const MoneyDepositedEvent = defineEvent(
        'MoneyDeposited',
        z.object({
          amount: z.number().positive(),
        }),
        (state, event) =>
          state
            ? { ...state, balance: state.balance + event.amount }
            : { balance: 0 }
      );

      // Act & Assert - Missing base field should fail
      expect(() =>
        MoneyDepositedEvent.schema.parse({
          aggregateType: 'account',
          // aggregateId missing!
          type: 'MoneyDeposited',
          version: 1,
          timestamp: '2025-11-15T10:00:00Z',
          amount: 100,
        })
      ).toThrow(ZodError);

      // Act & Assert - Missing custom field should fail
      expect(() =>
        MoneyDepositedEvent.schema.parse({
          aggregateType: 'account',
          aggregateId: 'acc-123',
          type: 'MoneyDeposited',
          version: 1,
          timestamp: '2025-11-15T10:00:00Z',
          // amount missing!
        })
      ).toThrow(ZodError);
    });

    it('should support TypeScript type inference for custom events', () => {
      // Arrange
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
          name: z.string(),
        }),
        (state, event) => ({
          id: event.aggregateId,
          email: event.email,
          name: event.name,
          balance: 0,
          version: event.version,
          createdAt: event.timestamp,
        })
      );

      type AccountCreatedEvent = z.infer<typeof AccountCreatedEvent.schema>;

      const event: AccountCreatedEvent = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'AccountCreated',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'alice@example.com',
        name: 'Alice',
      };

      // Act
      const result = AccountCreatedEvent.schema.parse(event);

      // Assert - TypeScript ensures type safety
      expect(result).toEqual(event);
    });
  });

  describe('AC-2.2.3: apply methods transform state functionally', () => {
    type AccountState = {
      id: string;
      email: string;
      name: string;
      balance: number;
      version: number;
      createdAt: string;
    };

    it('should apply method receive state and event as parameters', () => {
      // Arrange
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
          name: z.string(),
        }),
        (state: AccountState | null, event) => ({
          id: event.aggregateId,
          email: event.email,
          name: event.name,
          balance: 0,
          version: event.version,
          createdAt: event.timestamp,
        })
      );

      const eventData = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'AccountCreated',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'alice@example.com',
        name: 'Alice',
      };

      // Act
      const validatedEvent = AccountCreatedEvent.schema.parse(eventData);
      // eslint-disable-next-line prefer-spread
      const newState = AccountCreatedEvent.apply(null, validatedEvent);

      // Assert
      expect(newState).toBeDefined();
      expect(newState.id).toBe('acc-123');
    });

    it('should apply method return new state object (immutable transformation)', () => {
      // Arrange
      const currentState: AccountState = {
        id: 'acc-123',
        email: 'alice@example.com',
        name: 'Alice',
        balance: 100,
        version: 1,
        createdAt: '2025-11-15T10:00:00Z',
      };

      const MoneyDepositedEvent = defineEvent(
        'MoneyDeposited',
        z.object({
          amount: z.number().positive(),
        }),
        (state: AccountState | null, event) => {
          if (!state) {
            throw new Error('Cannot deposit before account created');
          }
          return {
            ...state,
            balance: state.balance + event.amount,
            version: event.version,
          };
        }
      );

      const eventData = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'MoneyDeposited',
        version: 2,
        timestamp: '2025-11-15T10:05:00Z',
        amount: 50,
      };

      // Act
      const validatedEvent = MoneyDepositedEvent.schema.parse(eventData);
      // eslint-disable-next-line prefer-spread
      const newState = MoneyDepositedEvent.apply(currentState, validatedEvent);

      // Assert - new state should be different object
      expect(newState).not.toBe(currentState);
      expect(newState.balance).toBe(150);
      expect(newState.version).toBe(2);
    });

    it('should keep original state unchanged after apply (immutability test)', () => {
      // Arrange
      const originalState: AccountState = {
        id: 'acc-123',
        email: 'alice@example.com',
        name: 'Alice',
        balance: 100,
        version: 1,
        createdAt: '2025-11-15T10:00:00Z',
      };

      const MoneyDepositedEvent = defineEvent(
        'MoneyDeposited',
        z.object({
          amount: z.number().positive(),
        }),
        (state: AccountState | null, event) => {
          if (!state) throw new Error('State required');
          return {
            ...state,
            balance: state.balance + event.amount,
            version: event.version,
          };
        }
      );

      const eventData = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'MoneyDeposited',
        version: 2,
        timestamp: '2025-11-15T10:05:00Z',
        amount: 50,
      };

      // Act
      const validatedEvent = MoneyDepositedEvent.schema.parse(eventData);
      // eslint-disable-next-line prefer-spread
      MoneyDepositedEvent.apply(originalState, validatedEvent);

      // Assert - original state must be unchanged
      expect(originalState.balance).toBe(100);
      expect(originalState.version).toBe(1);
    });

    it('should apply method work with null state (for first event)', () => {
      // Arrange
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
          name: z.string(),
        }),
        (state: AccountState | null, event) => ({
          id: event.aggregateId,
          email: event.email,
          name: event.name,
          balance: 0,
          version: event.version,
          createdAt: event.timestamp,
        })
      );

      const eventData = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'AccountCreated',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'alice@example.com',
        name: 'Alice',
      };

      // Act
      const validatedEvent = AccountCreatedEvent.schema.parse(eventData);
      // eslint-disable-next-line prefer-spread
      const newState = AccountCreatedEvent.apply(null, validatedEvent);

      // Assert
      expect(newState).toBeDefined();
      expect(newState.id).toBe('acc-123');
      expect(newState.balance).toBe(0);
    });

    it('should apply method access event base fields (aggregateId, version, timestamp)', () => {
      // Arrange
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
        }),
        (state: AccountState | null, event) => ({
          id: event.aggregateId, // Base field
          email: event.email,
          name: 'Default',
          balance: 0,
          version: event.version, // Base field
          createdAt: event.timestamp, // Base field
        })
      );

      const eventData = {
        aggregateType: 'account',
        aggregateId: 'acc-456',
        type: 'AccountCreated',
        version: 5,
        timestamp: '2025-11-15T14:30:00Z',
        email: 'bob@example.com',
      };

      // Act
      const validatedEvent = AccountCreatedEvent.schema.parse(eventData);
      // eslint-disable-next-line prefer-spread
      const newState = AccountCreatedEvent.apply(null, validatedEvent);

      // Assert
      expect(newState.id).toBe('acc-456');
      expect(newState.version).toBe(5);
      expect(newState.createdAt).toBe('2025-11-15T14:30:00Z');
    });

    it('should apply method access event custom data fields', () => {
      // Arrange
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
          name: z.string(),
        }),
        (state: AccountState | null, event) => ({
          id: event.aggregateId,
          email: event.email, // Custom field
          name: event.name, // Custom field
          balance: 0,
          version: event.version,
          createdAt: event.timestamp,
        })
      );

      const eventData = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'AccountCreated',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'custom@example.com',
        name: 'Custom Name',
      };

      // Act
      const validatedEvent = AccountCreatedEvent.schema.parse(eventData);
      // eslint-disable-next-line prefer-spread
      const newState = AccountCreatedEvent.apply(null, validatedEvent);

      // Assert
      expect(newState.email).toBe('custom@example.com');
      expect(newState.name).toBe('Custom Name');
    });

    it('should ensure state.version equals event.version after apply', () => {
      // Arrange
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
        }),
        (state: AccountState | null, event) => ({
          id: event.aggregateId,
          email: event.email,
          name: 'Test',
          balance: 0,
          version: event.version, // Critical: version must match
          createdAt: event.timestamp,
        })
      );

      const eventData = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'AccountCreated',
        version: 42,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'test@example.com',
      };

      // Act
      const validatedEvent = AccountCreatedEvent.schema.parse(eventData);
      // eslint-disable-next-line prefer-spread
      const newState = AccountCreatedEvent.apply(null, validatedEvent);

      // Assert
      expect(newState.version).toBe(42);
      expect(newState.version).toBe(eventData.version);
    });

    it('should apply multiple events sequentially to build up state', () => {
      // Arrange
      const AccountCreatedEvent = defineEvent(
        'AccountCreated',
        z.object({
          email: z.string().email(),
          name: z.string(),
        }),
        (state: AccountState | null, event) => ({
          id: event.aggregateId,
          email: event.email,
          name: event.name,
          balance: 0,
          version: event.version,
          createdAt: event.timestamp,
        })
      );

      const MoneyDepositedEvent = defineEvent(
        'MoneyDeposited',
        z.object({
          amount: z.number().positive(),
        }),
        (state: AccountState | null, event) => {
          if (!state) throw new Error('State required');
          return {
            ...state,
            balance: state.balance + event.amount,
            version: event.version,
          };
        }
      );

      // Act - Apply events sequentially
      const event1Data = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'AccountCreated',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'alice@example.com',
        name: 'Alice',
      };

      const event2Data = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'MoneyDeposited',
        version: 2,
        timestamp: '2025-11-15T10:05:00Z',
        amount: 100,
      };

      const event3Data = {
        aggregateType: 'account',
        aggregateId: 'acc-123',
        type: 'MoneyDeposited',
        version: 3,
        timestamp: '2025-11-15T10:10:00Z',
        amount: 50,
      };

      const validatedEvent1 = AccountCreatedEvent.schema.parse(event1Data);
      // eslint-disable-next-line prefer-spread
      const state1 = AccountCreatedEvent.apply(null, validatedEvent1);

      const validatedEvent2 = MoneyDepositedEvent.schema.parse(event2Data);
      // eslint-disable-next-line prefer-spread
      const state2 = MoneyDepositedEvent.apply(state1, validatedEvent2);

      const validatedEvent3 = MoneyDepositedEvent.schema.parse(event3Data);
      // eslint-disable-next-line prefer-spread
      const state3 = MoneyDepositedEvent.apply(state2, validatedEvent3);

      // Assert - final state should reflect all events
      expect(state3.id).toBe('acc-123');
      expect(state3.email).toBe('alice@example.com');
      expect(state3.balance).toBe(150);
      expect(state3.version).toBe(3);
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

  it('should handle complex event schemas with defineEvent', () => {
    // Arrange
    const TransferMoneyEvent = defineEvent(
      'TransferMoney',
      z.object({
        fromAccount: z.string().min(1),
        toAccount: z.string().min(1),
        amount: z.number().positive(),
        currency: z.enum(['USD', 'EUR', 'GBP']),
        note: z.string().optional(),
      }),
      (state, _event) => state // Simplified apply
    );

    const validEvent = {
      aggregateType: 'account',
      aggregateId: 'acc-123',
      type: 'TransferMoney',
      version: 1,
      timestamp: '2025-11-15T10:00:00Z',
      fromAccount: 'acc-123',
      toAccount: 'acc-456',
      amount: 100.5,
      currency: 'USD' as const,
    };

    // Act
    const result = TransferMoneyEvent.schema.parse(validEvent);

    // Assert
    expect(result.amount).toBe(100.5);
    expect(result.currency).toBe('USD');
    expect(result.note).toBeUndefined(); // Optional field
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
