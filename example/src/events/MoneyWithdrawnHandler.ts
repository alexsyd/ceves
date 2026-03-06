/**
 * MoneyWithdrawnHandler - Handle MoneyWithdrawn events
 *
 * Updates existing account state by decrementing balance
 */

import { EventHandler, type IEventHandler, type EventMetadata } from 'ceves';
import type { AccountState } from '../types';
import { MoneyWithdrawnEvent } from './MoneyWithdrawnEvent';

@EventHandler
export class MoneyWithdrawnHandler
  implements IEventHandler<AccountState, MoneyWithdrawnEvent>
{
  eventType = 'MoneyWithdrawn';
  aggregateType = 'BankAccountAggregate';

  /**
   * Apply MoneyWithdrawn event to decrement balance (ADR-009)
   *
   * **Architecture (ADR-008 + ADR-009):**
   * - Handler receives pure domain event and metadata separately
   * - Handler ALWAYS receives non-null state (guaranteed by framework)
   * - Handler just updates business logic (balance)
   * - Framework AUTO-SETS timestamp and version AFTER handler returns
   *
   * @param state - Current account state (ALWAYS non-null)
   * @param event - Pure domain event containing business data
   * @param metadata - Infrastructure metadata (aggregateId, version, timestamp, orgId)
   * @returns Updated AccountState (framework adds timestamp/version)
   */
  apply(
    state: AccountState,
    event: MoneyWithdrawnEvent,
    _metadata: EventMetadata
  ): AccountState {
    // No null check needed! Framework guarantees state exists for update events

    // Validate sufficient funds
    if (state.balance < event.amount) {
      throw new Error('Insufficient funds for withdrawal');
    }

    // Return new state with updated balance (immutable transformation)
    return {
      ...state,
      balance: state.balance - event.amount
      // timestamp and version auto-set by framework AFTER return
    };
  }
}
