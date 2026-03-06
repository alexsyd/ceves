/**
 * Abstract router for forwarding requests to Durable Objects
 *
 * Handles:
 * - Plural → singular aggregate type conversion (users → user, locks → lock)
 * - Smart POST routing (command in URL vs command in body)
 * - Authentication context forwarding
 */

const logger = { info: console.log, error: console.error, warn: console.warn, debug: console.debug };


export interface AuthContext {
  orgId?: string;
  userId?: string;
  email?: string;
  isAdmin?: boolean;
}

export class AggregateRouter {
  /**
   * Forward a request to the appropriate Durable Object
   * 
   * Smart routing for POST requests:
   * - If URL ends with /CommandName → route directly to DO
   * - If no command in URL → extract commandType from body, append to URL
   * 
   * @param env - Environment bindings with DO namespaces
   * @param request - Incoming request
   * @param authContext - Optional authentication context to inject into headers
   * @returns Response from Durable Object
   */
  static async forward(
    env: Record<string, unknown>,
    request: Request,
    authContext?: AuthContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean);

    if (pathSegments.length < 2) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'InvalidPathFormat',
          message: 'Path must include aggregate type and ID (e.g., /users/:id)',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Extract plural aggregate type and convert to singular
    // TypeScript: pathSegments[0] and pathSegments[1] are guaranteed to exist due to length check above
    const pluralType = pathSegments[0]!;
    const aggregateType = this.pluralToSingular(pluralType);
    const aggregateId = pathSegments[1]!;

    // Smart routing for POST requests without command in URL
    if (request.method === 'POST' && pathSegments.length === 2) {
      // No command in URL - extract from body and convert
      return await this.routeFromBody(env, aggregateType, aggregateId, request, authContext);
    }

    // Forward request as-is to Durable Object (GET or POST with command in URL)
    const forwardRequest = authContext
      ? this.createAuthenticatedRequest(request, authContext)
      : request;

    return await this.forwardToDurableObject(env, aggregateType, aggregateId, forwardRequest);
  }

  /**
   * Convert plural aggregate type to singular
   * 
   * Examples: users → user, locks → lock, hubs → hub
   */
  private static pluralToSingular(plural: string): string {
    const mapping: Record<string, string> = {
      users: 'user',
      locks: 'lock',
      hubs: 'hub',
      tempkeys: 'tempkey',
    };

    return mapping[plural.toLowerCase()] || plural;
  }

  /**
   * Convert singular aggregate type back to plural (for URL construction)
   */
  private static singularToPlural(singular: string): string {
    const mapping: Record<string, string> = {
      user: 'users',
      lock: 'locks',
      hub: 'hubs',
      tempkey: 'tempkeys',
    };

    return mapping[singular.toLowerCase()] || singular + 's';
  }

  /**
   * Inject auth context fields into request headers
   */
  private static injectAuthHeaders(headers: Headers, authContext: AuthContext): void {
    if (authContext.orgId) headers.set('X-Org-Id', authContext.orgId);
    if (authContext.userId) headers.set('X-User-Id', authContext.userId);
    if (authContext.email) headers.set('X-User-Email', authContext.email);
    if (authContext.isAdmin) headers.set('X-Is-Admin', 'true');
  }

  /**
   * Route POST request by extracting command from body
   * 
   * Old format: POST /users/:id with body: { commandType: "CreateUser", ... }
   * New format: POST /users/:id/CreateUser with body: { ... }
   */
  private static async routeFromBody(
    env: Record<string, unknown>,
    aggregateType: string,
    aggregateId: string,
    request: Request,
    authContext?: AuthContext
  ): Promise<Response> {
    // Parse body to extract commandType
    const bodyText = await request.text();
    let body: Record<string, unknown> = {};

    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch (error) {
      logger.debug('Invalid JSON in request body', { error: error instanceof Error ? error.message : String(error) });
      return new Response(
        JSON.stringify({
          success: false,
          error: 'InvalidRequestBody',
          message: 'Request body must be valid JSON',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Extract commandType from body
    const rawCommandType = body.commandType;
    if (!rawCommandType || typeof rawCommandType !== 'string') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'MissingCommandType',
          message: 'POST requests without command in URL must include commandType in body',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const commandType: string = rawCommandType;

    // Unwrap payload if present (legacy format support)
    // Old: { commandType: "CreateLock", aggregateId: "123", payload: { index: 1, uuid: "..." } }
    // New: { aggregateId: "123", index: 1, uuid: "..." }
    let commandData: Record<string, unknown>;
    const payload = body.payload;
    if (payload && typeof payload === 'object') {
      // Merge payload with aggregateId (preserve aggregateId from top level)
      commandData = {
        aggregateId: body.aggregateId || aggregateId,
        ...(payload as Record<string, unknown>),
      };
    } else {
      // Remove commandType from body, keep everything else
      commandData = { ...body };
      delete commandData.commandType;
    }

    // Build new URL with command at the end (convert to new format)
    const url = new URL(request.url);
    url.pathname = `/${this.singularToPlural(aggregateType)}/${aggregateId}/${commandType}`;

    // Create new request with modified URL and authentication context
    const headers = new Headers(request.headers);
    if (authContext) {
      this.injectAuthHeaders(headers, authContext);
    }

    const modifiedRequest = new Request(url.toString(), {
      method: request.method,
      headers,
      body: JSON.stringify(commandData),
    });

    return await this.forwardToDurableObject(env, aggregateType, aggregateId, modifiedRequest);
  }

  /**
   * Create authenticated request with auth context in headers
   */
  private static createAuthenticatedRequest(
    request: Request,
    authContext: AuthContext
  ): Request {
    const headers = new Headers(request.headers);
    this.injectAuthHeaders(headers, authContext);

    // Clone request with new headers
    return new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
      // @ts-expect-error - duplex is required for streaming bodies but not in RequestInit type
      duplex: 'half',
    });
  }

  /**
   * Forward request to Durable Object namespace
   */
  private static async forwardToDurableObject(
    env: Record<string, unknown>,
    aggregateType: string,
    aggregateId: string,
    request: Request
  ): Promise<Response> {
    // Map aggregate type to DO namespace binding
    const namespaceMap: Record<string, DurableObjectNamespace | undefined> = {
      user: env.USER as DurableObjectNamespace | undefined,
      lock: env.LOCK as DurableObjectNamespace | undefined,
      hub: env.HUB as DurableObjectNamespace | undefined,
      tempkey: env.TEMPKEY as DurableObjectNamespace | undefined,
    };

    const namespace = namespaceMap[aggregateType];
    if (!namespace) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'InvalidAggregateType',
          message: `Unknown aggregate type: ${aggregateType}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get DO stub and forward request
    const id = namespace.idFromName(aggregateId);
    const stub = namespace.get(id);
    return await stub.fetch(request);
  }
}
