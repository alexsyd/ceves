/**
 * Tenant Resolution Interface for Ceves Event Sourcing Library
 *
 * This module defines the pluggable tenant resolver interface that enables
 * different authentication strategies (API keys, JWT, custom) to be implemented
 * without changing core library code.
 *
 * Key Design Decisions:
 * - Single responsibility: resolve organization ID from HTTP request
 * - Pluggable architecture: multiple implementations supported
 * - Async by nature: supports database lookups, external API calls
 *
 * @packageDocumentation
 */

/**
 * Interface for resolving organization ID from HTTP requests.
 *
 * Implementations of this interface determine which organization (tenant) is making a request
 * by examining request headers, tokens, or other authentication mechanisms.
 *
 * This pluggable design enables:
 * - B2B authentication with API keys
 * - B2C authentication with JWT tokens
 * - Custom authentication strategies
 *
 * @example
 * ```typescript
 * // API key-based resolver
 * class ApiKeyTenantResolver implements ITenantResolver {
 *   constructor(private db: D1Database) {}
 *
 *   async resolveOrgId(request: Request): Promise<string> {
 *     const apiKey = request.headers.get('X-API-Key');
 *     if (!apiKey) throw new MissingApiKeyError();
 *
 *     const result = await this.db
 *       .prepare('SELECT org_id FROM api_keys WHERE api_key = ?')
 *       .bind(apiKey)
 *       .first();
 *
 *     if (!result) throw new InvalidApiKeyError();
 *     return result.org_id;
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // JWT-based resolver (B2C)
 * class JwtTenantResolver implements ITenantResolver {
 *   async resolveOrgId(request: Request): Promise<string> {
 *     const authHeader = request.headers.get('Authorization');
 *     if (!authHeader?.startsWith('Bearer ')) {
 *       throw new MissingTokenError();
 *     }
 *
 *     const token = authHeader.substring(7);
 *     const payload = await verifyJwt(token);
 *     return payload.orgId;
 *   }
 * }
 * ```
 */
export interface ITenantResolver {
  /**
   * Resolve organization ID from HTTP request.
   *
   * Implementations should:
   * 1. Extract authentication credentials from request (headers, cookies, etc.)
   * 2. Validate credentials (check database, verify signature, etc.)
   * 3. Return the organization ID associated with the credentials
   * 4. Throw appropriate errors for authentication/authorization failures
   *
   * @param request - Incoming HTTP request to resolve tenant from
   * @returns Promise resolving to the organization ID (tenant identifier)
   * @throws {MissingApiKeyError} If authentication credentials are missing
   * @throws {InvalidApiKeyError} If authentication credentials are invalid
   * @throws Custom errors for other authentication failures
   *
   * @example
   * ```typescript
   * const resolver = new ApiKeyTenantResolver(env.TENANT_DB);
   * const orgId = await resolver.resolveOrgId(request);
   * console.log(`Request from org: ${orgId}`);
   * ```
   */
  resolveOrgId(request: Request): Promise<string>;
}
