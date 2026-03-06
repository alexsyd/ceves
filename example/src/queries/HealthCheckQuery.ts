/**
 * Example Query Handler: Health Check Query
 *
 * Demonstrates an unscoped query handler that doesn't require an aggregate.
 * Useful for system-level queries like health checks, status endpoints, etc.
 *
 * @example
 * ```typescript
 * // Register in worker entry point
 * import './examples/queries/HealthCheckQuery';
 *
 * // HTTP GET request:
 * // GET /health
 * // Response: { status: 'ok', timestamp: '2024-01-01T00:00:00Z' }
 * ```
 */

import { z } from 'zod';
import { QueryHandler, IQueryHandler } from '@ceves/decorators/QueryHandler';

/**
 * Health check response type
 */
interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  version?: string;
}

/**
 * Health Check Query Handler
 *
 * Unscoped query (no aggregateType) - system-level health check.
 *
 * **Key characteristics:**
 * - Read-only operation
 * - Unscoped (not tied to any aggregate)
 * - Uses GET method
 * - No query parameters needed
 * - Returns system status
 *
 * **Usage:**
 * ```typescript
 * // Import to register
 * import './examples/queries/HealthCheckQuery';
 *
 * // HTTP Request
 * GET /health
 *
 * // Response
 * {
 *   "status": "ok",
 *   "timestamp": "2024-01-01T00:00:00.000Z",
 *   "version": "1.0.0"
 * }
 * ```
 */
@QueryHandler
export class HealthCheckQuery implements IQueryHandler<any, {}, HealthResponse> {
  // Required: Query type identifier
  queryType = 'HealthCheck';

  // aggregateType is omitted for unscoped queries
  // This query is registered as "HealthCheck" (not "SomeAggregate:HealthCheck")

  // Required: HTTP route pattern
  route = '/health';

  // Optional: HTTP method (defaults to GET)
  method = 'GET' as const;

  // Required: OpenAPI summary
  summary = 'Health check';

  // Optional: OpenAPI description
  description = 'Returns the health status of the system';

  // Optional: OpenAPI tags
  tags = ['System'];

  // Required: Response schemas by status code
  responses = {
    200: z.object({
      status: z.enum(['ok', 'degraded', 'down']),
      timestamp: z.string(),
      version: z.string().optional()
    })
  };

  /**
   * Execute query
   *
   * For unscoped queries, state parameter is typically not used.
   *
   * @param _state - Not used for unscoped queries
   * @param _query - Query parameters (empty for this query)
   * @returns Health status
   */
  async execute(_state: any, _query: {}): Promise<HealthResponse> {
    // Unscoped queries don't access aggregate state
    // They can perform system-level operations
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
  }
}
