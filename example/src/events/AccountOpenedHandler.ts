/**
 * AccountOpenedHandler - Handle AccountOpened events
 *
 * Creates initial account state from null (Story 9.8)
 */

import { EventHandler, type IEventHandler, type EventMetadata } from 'ceves';
import type { AccountState } from '../types';
import { AccountOpenedEvent } from './AccountOpenedEvent';

@EventHandler
export class AccountOpenedHandler
  implements IEventHandler<AccountState, AccountOpenedEvent>
{
  eventType = 'AccountOpened';
  aggregateType = 'BankAccountAggregate';

  /**
   * Apply AccountOpened event to create initial state (ADR-009)
   *
   * **Architecture (ADR-008 + ADR-009):**
   * - Handler receives pure domain event (only business data) and infrastructure metadata separately
   * - Handler ALWAYS receives non-null state (empty state for first event)
   * - Handler SETS id and orgId (business decisions from metadata)
   * - Framework AUTO-SETS timestamp and version AFTER handler returns
   *
   * @param state - Current state (NEVER null - empty for first event)
   * @param event - Pure domain event with owner and initialDeposit
   * @param metadata - Infrastructure metadata (aggregateId, version, timestamp, orgId)
   * @returns New AccountState with id and orgId set (framework adds timestamp/version)
   */
  apply(
    state: AccountState,
    event: AccountOpenedEvent,
    metadata: EventMetadata
  ): AccountState {
    // No null check needed! For first event: state === AccountState.empty()
    // Handler sets id and orgId (business decisions)
    return {
      ...state,
      id: metadata.aggregateId,
      orgId: metadata.orgId,         // Handler sets orgId (business decision)
      owner: event.owner,            // Pure business data from domain event
      balance: event.initialDeposit  // Pure business data from domain event
      // timestamp and version auto-set by framework AFTER return
    };
  }
}
