/**
 * MoneyDepositedEvent - Domain event for deposits
 *
 * Represents the business fact that money was deposited into an account.
 * Contains ONLY business data - no infrastructure fields.
 *
 * @packageDocumentation
 */

import type { DomainEvent } from 'ceves';

/**
 * Domain event emitted when money is deposited
 *
 * Pure business data:
 * - amount: How much was deposited
 *
 * Infrastructure fields (NOT included):
 * - aggregateId: Managed by StoredEvent envelope
 * - version: Auto-incremented by base class
 * - timestamp: Auto-set by base class
 * - orgId: Extracted from state/request by base class
 */
export class MoneyDepositedEvent implements DomainEvent {
  /**
   * Event type discriminator
   *
   * Using `as const` creates a literal type for discriminated unions
   */
  readonly type = 'MoneyDeposited' as const;

  /**
   * Create a new MoneyDeposited event
   *
   * @param amount - Amount deposited in cents
   */
  constructor(public readonly amount: number) {}
}
