/**
 * MoneyWithdrawnEvent - Domain event for money withdrawal
 *
 * Represents the business fact that money was withdrawn from an account.
 * Contains ONLY business data - no infrastructure fields.
 *
 * @packageDocumentation
 */

import type { DomainEvent } from 'ceves';

/**
 * Domain event emitted when money is withdrawn from an account
 *
 * Pure business data:
 * - amount: How much was withdrawn
 *
 * Infrastructure fields (NOT included):
 * - aggregateId: Managed by StoredEvent envelope
 * - version: Auto-incremented by base class
 * - timestamp: Auto-set by base class
 * - orgId: Extracted from state/request by base class
 */
export class MoneyWithdrawnEvent implements DomainEvent {
  /**
   * Event type discriminator
   *
   * Using `as const` creates a literal type for discriminated unions
   */
  readonly type = 'MoneyWithdrawn' as const;

  /**
   * Create a new MoneyWithdrawn event
   *
   * @param amount - Amount withdrawn in cents
   */
  constructor(
    public readonly amount: number
  ) {}
}
