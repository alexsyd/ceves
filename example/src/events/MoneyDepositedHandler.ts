/**
 * MoneyDepositedHandler - Handle MoneyDeposited events
 *
 * Updates existing account state by incrementing balance (Story 9.8)
 */

import { EventHandler, type IEventHandler, type EventMetadata } from 'ceves';
import type { AccountState } from '../types';
import { MoneyDepositedEvent } from './MoneyDepositedEvent';

@EventHandler
export class MoneyDepositedHandler
  implements IEventHandler<AccountState, MoneyDepositedEvent>
{
  eventType = 'MoneyDeposited';
  aggregateType = 'BankAccountAggregate';

  /**
   * Apply MoneyDeposited event to increment balance (ADR-009)
   *
   * **Architecture (ADR-008 + ADR-009):**
   * - Handler receives pure domain event and metadata separately
   * - Handler ALWAYS receives non-null state (guaranteed by framework)
   * - Handler just updates business logic (balance)
   * - Framework AUTO-SETS timestamp and version AFTER handler returns
   *
   * @param state - Current account state (ALWAYS non-null)
   * @param event - Pure domain event with amount
   * @param metadata - Infrastructure metadata (aggregateId, version, timestamp, orgId)
   * @returns Updated AccountState (framework adds timestamp/version)
   */
  apply(
    state: AccountState,
    event: MoneyDepositedEvent,
    _metadata: EventMetadata
  ): AccountState {
    // No null check needed! Framework guarantees state exists for update events
    // Just update business logic
    return {
      ...state,
      balance: state.balance + event.amount  // Pure business data from domain event
      // timestamp and version auto-set by framework AFTER return
    };
  }
}
