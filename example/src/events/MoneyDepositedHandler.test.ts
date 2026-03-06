/**
 * MoneyDepositedHandler Tests
 *
 * Demonstrates testing immutable state transformations with the new domain event pattern
 */

import { describe, it, expect } from 'vitest';
import { MoneyDepositedHandler } from './MoneyDepositedHandler';
import { MoneyDepositedEvent } from './MoneyDepositedEvent';
import type { AccountState } from '../types';
import type { EventMetadata } from 'ceves';

describe('MoneyDepositedHandler', () => {
  const createAccountState = (balance: number): AccountState => ({
    id: 'acc-123',
    owner: 'Alice',
    balance,
    version: 1,
    timestamp: '2025-11-15T10:00:00Z',
    orgId: 'org-1',
  });

  const createMetadata = (version: number): EventMetadata => ({
    aggregateId: 'acc-123',
    version,
    timestamp: '2025-11-15T11:00:00Z',
    orgId: 'org-1',
  });

  describe('apply()', () => {
    it('should increment balance by deposit amount', () => {
      // Arrange
      const handler = new MoneyDepositedHandler();
      const state = createAccountState(100);
      const event = new MoneyDepositedEvent(50);
      const metadata = createMetadata(2);

      // Act
      const newState = handler.apply(state, event, metadata);

      // Assert
      expect(newState.balance).toBe(150);
      // ADR-009: Framework auto-sets timestamp, so we just verify it's set
      expect(newState.timestamp).toBeDefined();
    });

    it('should not mutate original state (immutability)', () => {
      // Arrange
      const handler = new MoneyDepositedHandler();
      const state = createAccountState(100);
      const event = new MoneyDepositedEvent(50);
      const metadata = createMetadata(2);

      // Act
      const newState = handler.apply(state, event, metadata);

      // Assert
      expect(state.balance).toBe(100); // Original unchanged
      expect(newState.balance).toBe(150); // New state has update
      expect(newState).not.toBe(state); // Different object references
    });

    it('should preserve other state fields', () => {
      // Arrange
      const handler = new MoneyDepositedHandler();
      const state = createAccountState(100);
      const event = new MoneyDepositedEvent(25);
      const metadata = createMetadata(2);

      // Act
      const newState = handler.apply(state, event, metadata);

      // Assert
      expect(newState.id).toBe(state.id);
      expect(newState.owner).toBe(state.owner);
    });

    // ADR-009: Null state test removed - framework guarantees handlers always receive non-null state
  });
});
