/**
 * Example Query Handler: List Transactions Query
 *
 * Demonstrates a scoped query handler with pagination parameters.
 * Shows how to validate query parameters using Zod schemas.
 *
 * @example
 * ```typescript
 * // Register in worker entry point
 * import './examples/queries/ListTransactionsQuery';
 *
 * // HTTP GET request with query params:
 * // GET /accounts/acc-123/transactions?limit=10&offset=0&type=debit
 * // Response: { transactions: [...], total: 50, limit: 10, offset: 0 }
 * ```
 */

import { z } from 'zod';
import { QueryHandler, IQueryHandler } from '@ceves/decorators/QueryHandler';
import type { BaseState } from '@ceves/schemas/State';

/**
 * Bank account state interface with transaction history
 */
interface BankAccountState extends BaseState {
  balance: number;
  owner: string;
  transactions?: Array<{
    id: string;
    type: 'debit' | 'credit';
    amount: number;
    timestamp: string;
    description?: string;
  }>;
}

/**
 * Query parameters interface
 */
interface TransactionQueryParams {
  limit?: number;
  offset?: number;
  type?: 'debit' | 'credit';
}

/**
 * Query response type
 */
interface TransactionsResponse {
  transactions: Array<{
    id: string;
    type: 'debit' | 'credit';
    amount: number;
    timestamp: string;
    description?: string;
  }>;
  total: number;
  limit: number;
  offset: number;
}

/**
 * List Transactions Query Handler
 *
 * Scoped to BankAccountAggregate - retrieves transaction history with pagination.
 *
 * **Key characteristics:**
 * - Read-only operation (no state mutation)
 * - Scoped to specific aggregate type
 * - Uses GET method with query parameters
 * - Validates query params using Zod schema
 * - Supports filtering and pagination
 * - Returns paginated results
 *
 * **Usage:**
 * ```typescript
 * // Import to register
 * import './examples/queries/ListTransactionsQuery';
 *
 * // HTTP Request
 * GET /accounts/:id/transactions?limit=10&offset=0&type=debit
 *
 * // Response
 * {
 *   "transactions": [
 *     { "id": "txn-1", "type": "debit", "amount": 50, "timestamp": "2024-01-01T00:00:00Z" },
 *     { "id": "txn-2", "type": "debit", "amount": 100, "timestamp": "2024-01-02T00:00:00Z" }
 *   ],
 *   "total": 25,
 *   "limit": 10,
 *   "offset": 0
 * }
 * ```
 */
@QueryHandler
export class ListTransactionsQuery implements IQueryHandler<BankAccountState, TransactionQueryParams, TransactionsResponse> {
  // Required: Query type identifier
  queryType = 'ListTransactions';

  // Required: Aggregate type for scoped registration
  aggregateType = 'BankAccountAggregate';

  // Required: HTTP route pattern
  route = '/accounts/:id/transactions';

  // Optional: HTTP method (defaults to GET)
  method = 'GET' as const;

  // Required: OpenAPI summary
  summary = 'List account transactions';

  // Optional: OpenAPI description
  description = 'Retrieves paginated transaction history for a bank account with optional filtering';

  // Optional: OpenAPI tags
  tags = ['Bank Account', 'Queries', 'Transactions'];

  // Optional: Query parameters schema
  query = z.object({
    limit: z.coerce.number().int().positive().max(100).optional().default(10)
      .describe('Maximum number of transactions to return (default: 10, max: 100)'),
    offset: z.coerce.number().int().nonnegative().optional().default(0)
      .describe('Number of transactions to skip (default: 0)'),
    type: z.enum(['debit', 'credit']).optional()
      .describe('Filter by transaction type (optional)')
  });

  // Required: Response schemas by status code
  responses = {
    200: z.object({
      transactions: z.array(z.object({
        id: z.string(),
        type: z.enum(['debit', 'credit']),
        amount: z.number(),
        timestamp: z.string(),
        description: z.string().optional()
      })),
      total: z.number().describe('Total number of transactions matching filter'),
      limit: z.number().describe('Requested limit'),
      offset: z.number().describe('Requested offset')
    }),
    400: z.object({
      success: z.boolean(),
      error: z.string(),
      message: z.string(),
      details: z.array(z.any()).optional()
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
   * @param query - Validated query parameters
   * @returns Paginated transaction list
   */
  async execute(state: BankAccountState, query: TransactionQueryParams): Promise<TransactionsResponse> {
    // Get transactions from state (or empty array if none)
    const allTransactions = state.transactions || [];

    // Filter by type if specified
    let filtered = allTransactions;
    if (query.type) {
      filtered = allTransactions.filter(txn => txn.type === query.type);
    }

    // Apply pagination
    const limit = query.limit || 10;
    const offset = query.offset || 0;
    const paginated = filtered.slice(offset, offset + limit);

    // Return paginated results
    return {
      transactions: paginated,
      total: filtered.length,
      limit,
      offset
    };
  }
}
