/**
 * Durable Objects Mode Worker Entry Point
 *
 * This worker uses the DO-first architecture with command handlers as methods.
 * RouterWorker auto-discovers endpoints from @CommandHandler decorators.
 */

import { RouterWorker } from 'ceves';
import { BankAccountAggregate } from './aggregates/BankAccountAggregate';

// Import event handlers to trigger decorator registration
import './events/AccountOpenedHandler';
import './events/MoneyDepositedHandler';
import './events/MoneyWithdrawnHandler';

// Export Durable Object class
export { BankAccountAggregate };

/**
 * Worker fetch handler - auto-generates endpoints from @CommandHandler decorators
 *
 * Command handlers are now methods on BankAccountAggregate, decorated with @CommandHandler.
 * RouterWorker discovers these handlers and creates corresponding HTTP endpoints.
 */
export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const router = new RouterWorker(env);
    return router.fetch(request);
  },
};
