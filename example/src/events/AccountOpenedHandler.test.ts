/**
 * AccountOpenedHandler Tests
 *
 * Demonstrates how to unit test event handlers with the new domain event pattern.
 * Event handlers are tested by calling apply() with pure domain events and metadata.
 */

import { describe, it, expect } from 'vitest';
import { AccountOpenedHandler } from './AccountOpenedHandler';
import { AccountOpenedEvent } from './AccountOpenedEvent';
import { AccountState } from '../types';
import type { EventMetadata } from 'ceves';

describe('AccountOpenedHandler', () => {
  describe('apply()', () => {
    it('should create initial state from AccountOpened event', () => {
      // Arrange
      const handler = new AccountOpenedHandler();
      const event = new AccountOpenedEvent('Alice', 100);
      const metadata: EventMetadata = {
        aggregateId: 'acc-123',
        version: 1,
        timestamp: '2025-11-15T10:00:00Z',
        orgId: 'org-1',
      };
      // ADR-009: Handlers always receive non-null state (empty for first event)
      const state = AccountState.empty();

      // Act
      const newState = handler.apply(state, event, metadata);

      // Assert - ADR-009: Handler sets id, orgId, and business fields
      expect(newState.id).toBe('acc-123');
      expect(newState.orgId).toBe('org-1');
      expect(newState.owner).toBe('Alice');
      expect(newState.balance).toBe(100);
      // timestamp is auto-set by framework (not checked in unit test)
    });

    it('should create state with zero balance for zero initial deposit', () => {
      // Arrange
      const handler = new AccountOpenedHandler();
      const event = new AccountOpenedEvent('Bob', 0);
      const metadata: EventMetadata = {
        aggregateId: 'acc-456',
        version: 1,
        timestamp: '2025-11-15T11:00:00Z',
        orgId: 'org-1',
      };
      // ADR-009: Handlers always receive non-null state
      const state = AccountState.empty();

      // Act
      const newState = handler.apply(state, event, metadata);

      // Assert
      expect(newState.balance).toBe(0);
      expect(newState.owner).toBe('Bob');
    });

    // ADR-009: Null check test removed - framework guarantees handlers always receive non-null state
    // Command layer (CreateCommandRoute) enforces that AccountOpened only runs when state is null
  });
});
