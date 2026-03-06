/**
 * Example Query Handler: Get Balance Query
 *
 * Demonstrates a scoped query handler that retrieves the current balance
 * of a bank account aggregate. This is a read-only operation that does not
 * mutate state or emit events.
 *
 * @example
 * ```typescript
 * // Register in worker entry point
 * import './examples/queries/GetBalanceQuery';
 *
 * // HTTP GET request:
 * // GET /accounts/acc-123/balance
 * // Response: { balance: 1000, currency: 'USD' }
 * ```
 */

import { z } from 'zod';
import { QueryHandler, IQueryHandler } from '@ceves/decorators/QueryHandler';
import type { BaseState } from '@ceves/schemas/State';

/**
 * Bank account state interface
 * (In real application, this would be imported from aggregate definition)
 */
interface BankAccountState extends BaseState {
  balance: number;
  owner: string;
  currency?: string;
}

/**
 * Query response type
 */
interface BalanceResponse {
  balance: number;
  currency: string;
  accountId: string;
}

/**
 * Get Balance Query Handler
 *
 * Scoped to BankAccountAggregate - retrieves current account balance.
 *
 * **Key characteristics:**
 * - Read-only operation (no state mutation)
 * - Scoped to specific aggregate type
 * - Uses GET method (default)
 * - No query parameters needed
 * - Returns plain JSON object
 *
 * **Usage:**
 * ```typescript
 * // Import to register
 * import './examples/queries/GetBalanceQuery';
 *
 * // HTTP Request
 * GET /accounts/:id/balance
 *
 * // Response
 * {
 *   "balance": 1000,
 *   "currency": "USD",
 *   "accountId": "acc-123"
 * }
 * ```
 */
@QueryHandler
export class GetBalanceQuery implements IQueryHandler<BankAccountState, {}, BalanceResponse> {
  // Required: Query type identifier
  queryType = 'GetBalance';

  // Required: Aggregate type for scoped registration
  aggregateType = 'BankAccountAggregate';

  // Required: HTTP route pattern
  route = '/accounts/:id/balance';

  // Optional: HTTP method (defaults to GET)
  method = 'GET' as const;

  // Required: OpenAPI summary
  summary = 'Get account balance';

  // Optional: OpenAPI description
  description = 'Retrieves the current balance of a bank account';

  // Optional: OpenAPI tags
  tags = ['Bank Account', 'Queries'];

  // Required: Response schemas by status code
  responses = {
    200: z.object({
      balance: z.number().describe('Current account balance'),
      currency: z.string().describe('Currency code (e.g., USD, EUR)'),
      accountId: z.string().describe('Account identifier')
    }),
    404: z.object({
      success: z.boolean(),
      error: z.string(),
      message: z.string()
    })
  };

  /**
   * Execute query against aggregate state
   *
   * @param state - Current aggregate state (read-only)
   * @param query - Query parameters (empty for this query)
   * @returns Balance information
   */
  async execute(state: BankAccountState, _query: {}): Promise<BalanceResponse> {
    // Access state properties (read-only)
    // No state mutation, no events emitted
    return {
      balance: state.balance,
      currency: state.currency || 'USD',
      accountId: state.id
    };
  }
}
