/**
 * AccountOpenedEvent - Domain event for account creation
 *
 * Represents the business fact that a new bank account was opened.
 * Contains ONLY business data - no infrastructure fields.
 *
 * @packageDocumentation
 */

import type { DomainEvent } from 'ceves';

/**
 * Domain event emitted when a new account is opened
 *
 * Pure business data:
 * - owner: Who owns the account
 * - initialDeposit: Starting balance
 *
 * Infrastructure fields (NOT included):
 * - aggregateId: Managed by StoredEvent envelope
 * - version: Auto-incremented by base class
 * - timestamp: Auto-set by base class
 * - orgId: Extracted from state/request by base class
 */
export class AccountOpenedEvent implements DomainEvent {
  /**
   * Event type discriminator
   *
   * Using `as const` creates a literal type for discriminated unions
   */
  readonly type = 'AccountOpened' as const;

  /**
   * Create a new AccountOpened event
   *
   * @param owner - Email or identifier of the account owner
   * @param initialDeposit - Starting balance in cents
   */
  constructor(
    public readonly owner: string,
    public readonly initialDeposit: number
  ) {}
}
