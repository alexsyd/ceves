/**
 * Unit tests for State type definitions
 *
 * Tests cover:
 * - State type pattern with required fields (id, version, timestamp)
 * - State type conventions and examples
 * - Type inference and IDE autocomplete
 * - Edge cases and type safety
 */

import { describe, it, expect } from 'vitest';
import { BaseState } from './State';

describe('BaseState', () => {
  describe('State type pattern with required fields', () => {
    it('should have id field (string type)', () => {
      // Arrange
      const state: BaseState = {
        id: 'test-123',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert - TypeScript enforces type at compile time
      expect(state.id).toBe('test-123');
      expect(typeof state.id).toBe('string');
    });

    it('should have version field (number type)', () => {
      // Arrange
      const state: BaseState = {
        id: 'test-123',
        version: 42,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert
      expect(state.version).toBe(42);
      expect(typeof state.version).toBe('number');
    });

    it('should have timestamp field (string type)', () => {
      // Arrange
      const state: BaseState = {
        id: 'test-123',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert
      expect(state.timestamp).toBe('2025-11-15T10:00:00Z');
      expect(typeof state.timestamp).toBe('string');
    });

    it('should allow creating state objects with all required fields', () => {
      // Arrange & Act
      const state: BaseState = {
        id: 'aggregate-456',
        version: 5,
        timestamp: '2025-11-15T14:30:00.000Z',
      };

      // Assert
      expect(state).toEqual({
        id: 'aggregate-456',
        version: 5,
        timestamp: '2025-11-15T14:30:00.000Z',
      });
    });

    it('should support version = 1 (first event)', () => {
      // Arrange
      const initialState: BaseState = {
        id: 'agg-1',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act & Assert
      expect(initialState.version).toBe(1);
    });

    it('should support incrementing version numbers', () => {
      // Arrange
      const state1: BaseState = {
        id: 'agg-1',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
      };

      const state2: BaseState = {
        ...state1,
        version: 2,
        timestamp: '2025-11-15T10:05:00Z',
      };

      const state3: BaseState = {
        ...state2,
        version: 3,
        timestamp: '2025-11-15T10:10:00Z',
      };

      // Act & Assert
      expect(state1.version).toBe(1);
      expect(state2.version).toBe(2);
      expect(state3.version).toBe(3);
    });
  });

  describe('State type conventions and naming', () => {
    it('should support extending BaseState with custom fields using intersection types', () => {
      // Arrange - Following [DomainEntity]State naming convention
      type BankAccountState = BaseState & {
        email: string;
        balance: number;
      };

      const accountState: BankAccountState = {
        id: 'acc-123',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'alice@example.com',
        balance: 100,
      };

      // Act & Assert
      expect(accountState.id).toBe('acc-123');
      expect(accountState.email).toBe('alice@example.com');
      expect(accountState.balance).toBe(100);
    });

    it('should follow PascalCase + "State" suffix naming convention', () => {
      // Arrange - Examples of correct naming convention
      type UserProfileState = BaseState & {
        username: string;
        displayName: string;
      };

      type OrderState = BaseState & {
        items: string[];
        totalAmount: number;
      };

      type ShoppingCartState = BaseState & {
        items: Array<{ productId: string; quantity: number }>;
      };

      // Act
      const userState: UserProfileState = {
        id: 'user-1',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        username: 'alice',
        displayName: 'Alice Smith',
      };

      const orderState: OrderState = {
        id: 'order-1',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        items: ['item1', 'item2'],
        totalAmount: 99.99,
      };

      const cartState: ShoppingCartState = {
        id: 'cart-1',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        items: [{ productId: 'prod-1', quantity: 2 }],
      };

      // Assert - All follow naming convention and have required fields
      expect(userState.id).toBeDefined();
      expect(orderState.id).toBeDefined();
      expect(cartState.id).toBeDefined();
    });

    it('should support optional fields in custom state types', () => {
      // Arrange
      type AccountState = BaseState & {
        email: string;
        name: string;
        phoneNumber?: string; // Optional field
        preferredLanguage?: 'en' | 'es' | 'fr'; // Optional with union type
      };

      const stateWithoutOptional: AccountState = {
        id: 'acc-1',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'alice@example.com',
        name: 'Alice',
      };

      const stateWithOptional: AccountState = {
        id: 'acc-2',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'bob@example.com',
        name: 'Bob',
        phoneNumber: '+1-555-0123',
        preferredLanguage: 'en',
      };

      // Act & Assert
      expect(stateWithoutOptional.phoneNumber).toBeUndefined();
      expect(stateWithOptional.phoneNumber).toBe('+1-555-0123');
    });

    it('should support complex nested state structures', () => {
      // Arrange
      type OrderState = BaseState & {
        customerId: string;
        items: Array<{
          productId: string;
          quantity: number;
          price: number;
        }>;
        shippingAddress: {
          street: string;
          city: string;
          postalCode: string;
        };
        status: 'pending' | 'confirmed' | 'shipped';
      };

      const orderState: OrderState = {
        id: 'order-456',
        version: 2,
        timestamp: '2025-11-15T11:00:00Z',
        customerId: 'cust-789',
        items: [
          { productId: 'prod-1', quantity: 2, price: 29.99 },
          { productId: 'prod-2', quantity: 1, price: 49.99 },
        ],
        shippingAddress: {
          street: '123 Main St',
          city: 'San Francisco',
          postalCode: '94102',
        },
        status: 'confirmed',
      };

      // Act & Assert
      expect(orderState.items).toHaveLength(2);
      expect(orderState.items[0].productId).toBe('prod-1');
      expect(orderState.shippingAddress.city).toBe('San Francisco');
      expect(orderState.status).toBe('confirmed');
    });
  });

  describe('Type inference and IDE autocomplete', () => {
    it('should infer types correctly from BaseState', () => {
      // Arrange
      const state: BaseState = {
        id: 'test',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
      };

      // Act - TypeScript infers types
      const id: string = state.id;
      const version: number = state.version;
      const timestamp: string = state.timestamp;

      // Assert
      expect(typeof id).toBe('string');
      expect(typeof version).toBe('number');
      expect(typeof timestamp).toBe('string');
    });

    it('should infer custom state types correctly', () => {
      // Arrange
      type AccountState = BaseState & {
        email: string;
        balance: number;
        isActive: boolean;
      };

      const account: AccountState = {
        id: 'acc-123',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        email: 'test@example.com',
        balance: 100,
        isActive: true,
      };

      // Act - TypeScript infers all fields
      const email: string = account.email;
      const balance: number = account.balance;
      const isActive: boolean = account.isActive;

      // Assert
      expect(email).toBe('test@example.com');
      expect(balance).toBe(100);
      expect(isActive).toBe(true);
    });

    it('should work with spread operator for immutable updates', () => {
      // Arrange
      type AccountState = BaseState & {
        balance: number;
      };

      const state1: AccountState = {
        id: 'acc-1',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        balance: 100,
      };

      // Act - Immutable update (create new state)
      const state2: AccountState = {
        ...state1,
        balance: 150,
        version: 2,
        timestamp: '2025-11-15T10:05:00Z',
      };

      // Assert - Original unchanged, new state created
      expect(state1.balance).toBe(100);
      expect(state1.version).toBe(1);
      expect(state2.balance).toBe(150);
      expect(state2.version).toBe(2);
    });

    it('should support type guards for null checks', () => {
      // Arrange
      type AccountState = BaseState & {
        email: string;
      };

      const state: AccountState | null = null;

      // Act & Assert - Type guard pattern common in apply methods
      if (state === null) {
        expect(state).toBeNull();
      } else {
        // TypeScript knows state is AccountState here
        expect(state.email).toBeDefined();
      }
    });
  });

})
