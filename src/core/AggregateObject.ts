/**
 * AggregateObject - Base class for Durable Object aggregates
 *
 * This class implements the core pattern for event-sourced aggregates running
 * in Cloudflare Durable Objects. It provides:
 * - In-memory state management with automatic event application
 * - Zero-latency state persistence via DO Storage API (SQLite-backed)
 * - Automatic state restoration from DO storage or R2 migration
 * - Command handler discovery and execution via decorator registry
 * - Query handler discovery and execution via decorator registry
 * - Event persistence to R2 for event sourcing audit log
 *
 * @packageDocumentation
 */

import { DurableObject } from 'cloudflare:workers';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { applyEventToState, executeSideEffects } from '../decorators/EventHandler';
import type { IEventStore, ISnapshotStore, StoredEvent } from '../storage/interfaces';
import type { BaseState } from '../schemas/State';
import type { ITenantResolver } from '../tenancy/TenantResolver';
import { HeaderTenantResolver } from '../tenancy/HeaderTenantResolver';
import { R2EventStore } from '../storage/R2EventStore';
import { CevesError } from '../errors/CevesError';
import { AggregateNotFoundError } from '../errors/AggregateNotFoundError';
import { BusinessRuleViolationError } from '../errors/BusinessRuleViolationError';
import { NO_EVENT, type DomainEvent } from '../events/DomainEvent';
import { findRouteByUrl } from '../routing/Route.js';

/**
 * Interface for command handler instances that can be discovered by DO
 */
interface CommandHandlerInstance {
  aggregateType?: string;
  executeCommand?: (command: unknown, state: unknown, env: unknown) => Promise<DomainEvent | typeof NO_EVENT>;
}

/**
 * Interface for command handler classes with static isCreateCommand property
 */
interface CommandHandlerClass {
  isCreateCommand?: boolean;
  name: string;
}

/**
 * Interface for route match result from findRouteByUrl
 */
interface RouteMatchResult {
  RouteClass: new () => unknown;
  params: Record<string, string>;
}

/**
 * Type-safe wrapper for findRouteByUrl
 * Uses explicit type assertions to handle workspace package type resolution
 * during lint (before ceves is built)
 */
function findCommandRouteByUrl(method: string, pathname: string): RouteMatchResult | undefined {
  // Call the ceves function - types may not be available at lint time
  const result = (findRouteByUrl as (m: string, p: string) => {
    RouteClass: new () => unknown;
    params: Record<string, string>;
  } | undefined)(method, pathname);

  if (!result) return undefined;

  return {
    RouteClass: result.RouteClass,
    params: result.params,
  };
}

/**
 * Environment interface for AggregateObject
 */
export interface AggregateObjectEnv {
  EVENTS_BUCKET?: R2Bucket;
  SNAPSHOTS_BUCKET?: R2Bucket;
  ADMIN_API_KEY?: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  DEFAULT_ORG_ID?: string;
  [key: string]: unknown;
}

/**
 * Base class for Durable Object aggregates
 *
 * Subclasses must:
 * 1. Pass the state class to super() constructor (matches generic type parameter)
 * 2. Import all command and event handlers in the worker entry point
 *
 * Everything else is automatic:
 * - aggregateType is derived from class name (e.g., BankAccountAggregate)
 * - Command execution via @CommandHandler registry
 * - Query execution via @QueryHandler registry
 * - Event application via @EventHandler registry
 * - State restoration and persistence
 *
 * @example
 * ```typescript
 * import { AggregateObject } from 'ceves';
 *
 * export class BankAccountAggregate extends AggregateObject<BankAccountState> {
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     super(ctx, env, BankAccountState);  // That's it!
 *   }
 * }
 * ```
 *
 * @template TState - The aggregate state type (must extend BaseState)
 */
export abstract class AggregateObject<TState extends BaseState = BaseState> extends DurableObject {
  /**
   * In-memory aggregate state
   * Null if aggregate doesn't exist yet (no events)
   */
  protected state: TState | null = null;

  /**
   * Flag indicating whether state has been loaded from storage
   * Ensures state is only loaded once per DO lifecycle
   */
  protected stateLoaded = false;

  /**
   * Flag indicating this is a brand new aggregate with no prior state
   * When true, skips R2 snapshot/events loading for performance
   */
  protected isNewAggregate = false;

  /**
   * Event store for persisting events (R2)
   */
  protected eventStore!: IEventStore;

  /**
   * Snapshot store for saving/loading state snapshots (R2)
   * @deprecated Snapshots are no longer used - state is persisted to DO storage.
   * This property is kept for backward compatibility during R2-to-DO migration.
   */
  protected snapshotStore!: ISnapshotStore;

  /**
   * Tenant resolver for multitenancy support
   */
  protected tenantResolver!: ITenantResolver;

  /**
   * Aggregate ID (extracted from DO ID)
   */
  protected aggregateId: string;

  /**
   * Durable Object state context
   * Stored explicitly because the mocked DurableObject class in unit tests doesn't provide it
   */
  protected declare ctx: DurableObjectState<Record<string, unknown>>;

  /**
   * Environment bindings
   */
  protected override env: AggregateObjectEnv;

  /**
   * Logger instance for aggregate operations
   */
  protected logger = { info: console.log, error: console.error, warn: console.warn, debug: console.debug };

  /**
   * Get the aggregate type from the class name
   * Automatically derived from constructor.name, so no manual configuration needed
   *
   * Uses the class name as-is for event storage and handler registration.
   * Example: BankAccountAggregate → 'BankAccountAggregate'
   *
   * Override this getter if you need a custom aggregate type identifier.
   */
  protected get aggregateType(): string {
    return this.constructor.name;
  }

  /**
   * State class constructor for creating empty state instances (state class pattern)
   * Set via constructor parameter to avoid duplication with generic type
   */
  private StateClass: new () => TState;

  /**
   * Get the state class constructor (state class pattern)
   * Used internally for state restoration and empty state creation
   */
  protected getStateClass(): new () => TState {
    return this.StateClass;
  }

  /**
   * Constructor
   *
   * @param ctx - Durable Object state
   * @param env - Environment bindings
   * @param StateClass - State class constructor (matches the generic type parameter)
   *
   * @example
   * ```typescript
   * export class BankAccountAggregate extends AggregateObject<AccountState> {
   *   constructor(ctx: DurableObjectState, env: Env) {
   *     super(ctx, env, AccountState);  // Pass state class once
   *   }
   * }
   * ```
   */
  constructor(ctx: DurableObjectState, env: AggregateObjectEnv, StateClass: new () => TState) {
    super(ctx, env);
    // Cast needed: DurableObjectState from platform is untyped, we use Record<string, unknown> internally
    this.ctx = ctx as DurableObjectState<Record<string, unknown>>;
    this.env = env;
    this.StateClass = StateClass;

    // Extract aggregateId from DO ID (initially uses hex hash, updated after state loads)
    // Note: ctx.id.name is not exposed in Miniflare/workerd, so we start with hex hash
    // After state loads, we update this to use state.id (human-readable ID)
    this.aggregateId = ctx.id.toString();

    // Initialize storage (subclasses can override by setting in constructor)
    this.initializeStores(env);

    // Load state from DO storage during initialization
    // blockConcurrencyWhile prevents requests until complete
    void ctx.blockConcurrencyWhile(async () => {
      try {
        // Try DO storage first (new approach)
        const storedState = await ctx.storage.get<TState>('state');

        if (storedState) {
          this.logger.info('Loaded state from DO storage', {
            aggregateType: this.aggregateType,
            aggregateId: this.aggregateId,
            version: storedState.version,
          });
          this.state = storedState;
          this.stateLoaded = true;

          // Use human-readable ID from state if available (instead of hex hash from ctx.id)
          if (this.state.id) {
            this.aggregateId = this.state.id;
            this.logger.info('Using human-readable ID from state', {
              aggregateType: this.aggregateType,
              aggregateId: this.aggregateId,
            });
          }
        } else {
          // No state in DO storage - this is a brand new aggregate
          // Set flag to skip R2 checks for performance (~350ms savings)
          this.isNewAggregate = true;
          this.logger.info('New aggregate detected, will skip R2 migration checks', {
            aggregateType: this.aggregateType,
            aggregateId: this.aggregateId,
          });
        }

        // If no state in DO storage, will load from R2 in ensureStateLoaded()
        // This supports migration from R2 snapshots to DO storage
      } catch (error) {
        this.logger.error('Error loading state from DO storage', {
          aggregateType: this.aggregateType,
          aggregateId: this.aggregateId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fall back to R2 snapshot loading in ensureStateLoaded()
      }
    });
  }

  /**
   * Initialize event store and snapshot store
   * Can be overridden by subclasses for custom storage configuration
   *
   * Note: Snapshot store is not auto-initialized here. Use R2SnapshotStore or D1SnapshotStore
   * and set it via setStores() or override this method in your subclass.
   *
   * @param env - Environment bindings
   */
  protected initializeStores(env: AggregateObjectEnv): void {
    // Auto-initialize R2 event store from environment bindings
    if (env.EVENTS_BUCKET) {
      this.eventStore = new R2EventStore(env.EVENTS_BUCKET);
      // Snapshot store is not set here - use R2SnapshotStore or D1SnapshotStore separately
    }

    // Auto-initialize tenant resolver with default for local development
    // Uses DEFAULT_ORG_ID from env vars or falls back to 'default-org'
    if (!this.tenantResolver) {
      const defaultOrgId = (typeof env.DEFAULT_ORG_ID === 'string' ? env.DEFAULT_ORG_ID : undefined) ?? 'default-org';
      this.tenantResolver = new HeaderTenantResolver('X-Org-Id', defaultOrgId);
    }

    // Subclasses can override this method for custom storage configuration
  }

  /**
   * Set storage instances and tenant resolver (for dependency injection)
   *
   * @param eventStore - Event store implementation
   * @param snapshotStore - Snapshot store implementation (deprecated, kept for backward compatibility)
   * @param tenantResolver - Tenant resolver implementation
   * @internal
   */
  setStores(
    eventStore: IEventStore,
    snapshotStore: ISnapshotStore,
    tenantResolver: ITenantResolver
  ): void {
    this.eventStore = eventStore;
    this.snapshotStore = snapshotStore;
    this.tenantResolver = tenantResolver;
  }

  /**
   * Main entry point - receives requests forwarded from Worker via CommandRoute/QueryRoute
   *
   * ROUTING PATTERN:
   * 1. Worker receives request (e.g., POST /users/:id/CreateUser)
   * 2. @Route decorated CommandRoute/QueryRoute handles validation and forwards to DO
   * 3. DO.fetch() routes to appropriate handler method
   * 4. Commands execute IN the DO, produce events, persist state
   * 5. Queries return state for QueryRoute to process
   *
   * INTERNAL ENDPOINTS:
   * - GET /__state: Return raw aggregate state (for QueryRoute)
   * - DELETE with X-Admin-Delete: Admin cleanup operation
   *
   * @param request - HTTP request forwarded from Worker
   * @returns HTTP response with execution result
   */
  override async fetch(request: Request): Promise<Response> {
    this.logger.debug('fetch() ENTRY', {
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
      url: request.url,
      method: request.method,
    });

    try {
      // Handle admin delete (bypasses normal auth)
      if (request.method === 'DELETE' && request.headers.get('X-Admin-Delete') === 'true') {
        return this.handleAdminDelete(request);
      }

      // Load state (only once per DO lifecycle)
      this.ensureStateLoaded();

      const url = new URL(request.url);
      const pathSegments = url.pathname.split('/').filter(Boolean);
      const lastSegment = pathSegments[pathSegments.length - 1];

      // Authorization check
      try {
        this.checkAuthorization(request);
      } catch (error) {
        this.logger.warn('Authorization failed', {
          aggregateType: this.aggregateType,
          aggregateId: this.aggregateId,
          error: error instanceof Error ? error.message : String(error),
        });
        return this.handleError(error);
      }

      // Handle internal state query (for QueryRoute pattern)
      if (request.method === 'GET' && lastSegment === '__state') {
        return this.handleStateQuery();
      }

      // Look up and execute command handler
      const routeMatchResult = findCommandRouteByUrl(request.method, url.pathname);
      if (routeMatchResult) {
        const response = await this.handleCommandExecution(routeMatchResult, request);
        if (response) {
          return response;
        }
      }

      // No handler found
      this.logger.warn('No handler found', {
        aggregateType: this.aggregateType,
        aggregateId: this.aggregateId,
        method: request.method,
        pathname: url.pathname,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: 'NotFound',
          message: `No handler found for ${request.method} ${url.pathname}`,
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Handle admin delete request
   *
   * Validates dual authentication (API key + JWT with allowed domain)
   * and clears all DO storage.
   */
  private async handleAdminDelete(request: Request): Promise<Response> {
    this.logger.info('Admin delete request received', {
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
    });

    const adminApiKey = request.headers.get('X-Admin-API-Key');
    const authHeader = request.headers.get('Authorization');

    // Check admin API key
    if (!adminApiKey || adminApiKey !== this.env.ADMIN_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized', message: 'Invalid admin API key' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check Authorization header
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized', message: 'Missing Authorization header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify JWT with allowed email domain
    try {
      const { decodeJwt } = await import('jose');
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const payload = decodeJwt(token);

      const email = typeof payload.email === 'string' ? payload.email : undefined;
      const allowedDomain = this.env.ALLOWED_EMAIL_DOMAIN ?? 'example.com';

      if (!email || !email.endsWith(`@${allowedDomain}`)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Forbidden',
            message: `Email domain must be @${allowedDomain}`,
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized', message: 'Invalid JWT token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Clear DO storage
    this.logger.info('Clearing DO storage (admin delete)', {
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
    });
    await this.ctx.storage.deleteAll();
    this.state = null;
    this.stateLoaded = false;

    return new Response(
      JSON.stringify({ success: true, message: 'Durable Object storage cleared' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Handle internal state query (GET /__state)
   *
   * Returns raw aggregate state for QueryRoute pattern.
   */
  private handleStateQuery(): Response {
    this.logger.debug('Returning raw state', {
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
    });
    return new Response(JSON.stringify(this.state), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle command execution via registered CommandRoute
   *
   * @returns Response if this is a command route, null if should fall through
   */
  private async handleCommandExecution(
    routeMatch: RouteMatchResult,
    request: Request
  ): Promise<Response | null> {
    const { RouteClass, params: pathParams } = routeMatch;

    // Create instance and check if this is a CommandRoute
    const RouteConstructor = RouteClass as unknown as new () => CommandHandlerInstance;
    const handlerInstance: CommandHandlerInstance = new RouteConstructor();

    // Skip if not a command route (let queries fall through)
    if (!handlerInstance.aggregateType || !handlerInstance.executeCommand) {
      return null;
    }

    const HandlerClass = RouteClass as unknown as CommandHandlerClass;
    this.logger.debug('Found command handler', {
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
      handler: HandlerClass.name,
      pathParams,
    });

    try {
      // Check create/update semantics
      const isCreateCommand = HandlerClass.isCreateCommand ?? false;

      if (isCreateCommand && this.state !== null) {
        this.logger.warn('Create command on existing aggregate', {
          aggregateType: this.aggregateType,
          aggregateId: this.aggregateId,
          handler: HandlerClass.name,
        });
        throw new BusinessRuleViolationError(
          `Aggregate ${this.aggregateId} already exists. Cannot execute create command.`,
          this.aggregateType,
          this.aggregateId
        );
      }

      if (!isCreateCommand && this.state === null) {
        this.logger.warn('Update command on non-existent aggregate', {
          aggregateType: this.aggregateType,
          aggregateId: this.aggregateId,
          handler: HandlerClass.name,
        });
        throw new AggregateNotFoundError(this.aggregateType, this.aggregateId);
      }

      // Build command from request body (handle empty body for DELETE)
      let requestBody: Record<string, unknown> = {};
      try {
        const text = await request.text();
        if (text) {
          requestBody = JSON.parse(text) as Record<string, unknown>;
        }
      } catch (bodyError) {
        this.logger.error('Failed to parse request body as JSON', {
          aggregateType: this.aggregateType,
          aggregateId: this.aggregateId,
          handler: HandlerClass.name,
          error: bodyError instanceof Error ? bodyError.message : String(bodyError),
        });
        return new Response(
          JSON.stringify({
            success: false,
            error: 'InvalidRequestBody',
            message: 'Request body must be valid JSON',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      this.logger.debug('Executing command', {
        aggregateType: this.aggregateType,
        aggregateId: this.aggregateId,
        handler: HandlerClass.name,
        isCreateCommand,
      });

      // Execute command - produces domain event (or NO_EVENT for idempotent skip)
      // CreateCommandRoute expects (command, env) - 2 params
      // CommandRoute expects (command, state, env) - 3 params
      // For create commands, pass env as second param; for update commands, pass state then env
      const domainEvent = isCreateCommand
        ? await (handlerInstance.executeCommand as (cmd: unknown, env: unknown) => Promise<DomainEvent | typeof NO_EVENT>)(
            requestBody,
            this.env
          )
        : await handlerInstance.executeCommand(requestBody, this.state, this.env);

      // Check for NO_EVENT sentinel - skip apply/persist, return success
      if (domainEvent === NO_EVENT) {
        this.logger.info('Command returned NO_EVENT, skipping persist', {
          aggregateType: this.aggregateType,
          aggregateId: this.aggregateId,
          handler: HandlerClass.name,
        });
        return new Response(
          JSON.stringify({
            success: true,
            aggregateId: this.aggregateId,
            version: this.state?.version ?? 0,
            noEvent: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Apply and persist
      return this.applyAndPersistEvent(domainEvent, request, HandlerClass.name);
    } catch (error) {
      this.logger.error('Command execution error', {
        aggregateType: this.aggregateType,
        aggregateId: this.aggregateId,
        handler: HandlerClass.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.handleError(error);
    }
  }

  /**
   * Apply domain event to state and persist
   *
   * Shared logic for event application, state persistence, R2 storage, and side effects.
   */
  private async applyAndPersistEvent(
    domainEvent: DomainEvent,
    request: Request,
    handlerName?: string
  ): Promise<Response> {
    const version = (this.state?.version ?? 0) + 1;
    const requestOrgId = await this.tenantResolver.resolveOrgId(request);
    const eventOrgId = this.state?.orgId ?? requestOrgId;

    const storedEvent: StoredEvent = {
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
      version,
      type: domainEvent.type,
      timestamp: new Date().toISOString(),
      orgId: eventOrgId,
      event: domainEvent,
    };

    this.logger.info('Applying event', {
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
      eventType: storedEvent.type,
      handler: handlerName,
    });

    // Apply event to in-memory state
    this.applyEvent(storedEvent);

    // Update aggregateId to use human-readable ID from state
    if (this.state?.id && this.aggregateId !== this.state.id) {
      const oldId = this.aggregateId;
      this.aggregateId = this.state.id;
      storedEvent.aggregateId = this.state.id;
      this.logger.info('Updated aggregateId to human-readable ID', {
        aggregateType: this.aggregateType,
        aggregateId: this.aggregateId,
        oldId,
      });
    }

    // Persist state to DO storage
    if (this.state) {
      await this.ctx.storage.put('state', this.state);
      this.logger.info('Persisted state to DO storage', {
        aggregateType: this.aggregateType,
        aggregateId: this.aggregateId,
        version: this.state.version,
      });
    }

    // Persist event to R2 (fire-and-forget)
    this.persistEvent(storedEvent).catch((err) => {
      this.logger.error('Failed to persist event to R2', {
        aggregateType: this.aggregateType,
        aggregateId: this.aggregateId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Execute side effects
    try {
      await executeSideEffects(this.aggregateType, storedEvent, this.env);
      this.logger.info('Side effects completed', {
        aggregateType: this.aggregateType,
        aggregateId: this.aggregateId,
      });
    } catch (sideEffectError) {
      this.logger.error('Side effects failed', {
        aggregateType: this.aggregateType,
        aggregateId: this.aggregateId,
        eventType: storedEvent.type,
        error: sideEffectError instanceof Error ? sideEffectError.message : String(sideEffectError),
      });
      const errorMessage = sideEffectError instanceof Error ? sideEffectError.message : String(sideEffectError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'SideEffectError',
          message: `Event applied but side effects failed: ${errorMessage}`,
          aggregateId: this.aggregateId,
          version,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, aggregateId: this.aggregateId, version }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  protected applyEvent(event: StoredEvent): void {
    // Use applyEventToState utility - provides empty state for first event (state class pattern)
    this.state = applyEventToState<TState>(
      this.aggregateType,
      this.state,
      event,
      this.getStateClass()
    );
  }

  /**
   * Persist event to R2
   *
   * @param event - Event to persist
   */
  protected async persistEvent(event: StoredEvent): Promise<void> {
    if (!this.eventStore) {
      throw new Error('Event store not initialized');
    }

    await this.eventStore.save(event);
  }

  /**
   * Ensure state is loaded from storage (snapshot + events)
   *
   * This method is called once per DO lifecycle, on the first request.
   * Subsequent requests use the in-memory state directly.
   *
   * Flow:
   * 1. Check if state already loaded (exit early if true)
   * 2. Try to load latest snapshot
   * 3. If snapshot found, load incremental events after snapshot version
   * 4. If no snapshot, load all events from beginning
   * 5. Apply all events to rebuild state
   * 6. Mark state as loaded
   */
  protected ensureStateLoaded(): void {
    if (this.stateLoaded) {
      return;
    }

    this.logger.debug('Marking state as loaded (loaded from DO storage in constructor)', {
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
    });
    this.stateLoaded = true;
  }

  /**
   * Handle errors during command/query execution
   *
   * Distinguishes between:
   * - CevesError instances with specific HTTP status codes (400, 401, 403, 404, 409, etc.)
   * - Unexpected errors (500 Internal Server Error)
   *
   * All error responses use chanfana's standard format:
   * { success: false, errors: [{ code: number, message: string }] }
   *
   * @param error - Error that occurred
   * @returns Error response in chanfana format
   */


  protected handleError(error: unknown): Response {
    this.logger.error('Error', {
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
      error: error instanceof Error ? error.message : String(error),
    });

    const message = error instanceof Error ? error.message : 'Unknown error';

    // CevesError instances preserve their HTTP status codes
    if (error instanceof CevesError) {
      return new Response(
        JSON.stringify({
          success: false,
          errors: [
            {
              code: error.httpStatusCode,
              message: error.message,
            },
          ],
        }),
        {
          status: error.httpStatusCode,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Unexpected errors return 500 Internal Server Error
    return new Response(
      JSON.stringify({
        success: false,
        errors: [
          {
            code: 500,
            message,
          },
        ],
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  /**
   * Authorization hook - override to implement custom authorization logic
   *
   * Called automatically before executing commands and queries.
   * Default implementation allows all requests (no-op).
   *
   * Override this method in aggregate subclasses to:
   * - Validate authentication credentials (API keys, JWTs, etc.)
   * - Check resource ownership (e.g., user owns this aggregate)
   * - Enforce role-based access control (RBAC)
   * - Implement multi-tenancy authorization
   * - Allow public access to specific endpoints
   *
   * **Throwing errors:**
   * - Throw `UnauthorizedError` (401) when authentication is missing/invalid
   * - Throw `ForbiddenError` (403) when authenticated but lacks permission
   * - Throw other `CevesError` subclasses for domain-specific authorization failures
   *
   * **Access to request and state:**
   * - `request.headers` - Extract auth tokens, user IDs, org IDs, etc.
   * - `request.url` - Check pathname for public endpoints
   * - `this.state` - Validate ownership/permissions against aggregate state
   *
   * @param request - HTTP request with headers for authorization
   * @throws {UnauthorizedError} If authentication is missing or invalid
   * @throws {ForbiddenError} If authenticated but lacks permission
   * @throws {CevesError} For other authorization failures
   *
   * @example
   * ```typescript
   * // B2C authorization: Check user owns the resource
   * protected override checkAuthorization(request: Request): void {
   *   const userId = request.headers.get('X-User-Id');
   *   if (!userId) {
   *     throw new UnauthorizedError('Missing user ID');
   *   }
   *   if (this.state?.ownerId && this.state.ownerId !== userId) {
   *     throw new ForbiddenError('User does not own this resource');
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * // B2B authorization: Check organization match
   * protected override checkAuthorization(request: Request): void {
   *   const orgId = request.headers.get('X-Org-Id');
   *   if (!orgId) {
   *     throw new UnauthorizedError('Missing organization ID');
   *   }
   *   if (this.state?.orgId && this.state.orgId !== orgId) {
   *     throw new ForbiddenError('Organization mismatch');
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Allow public access to specific endpoints
   * protected override checkAuthorization(request: Request): void {
   *   const url = new URL(request.url);
   *
   *   // Public endpoints - no auth required
   *   if (url.pathname.endsWith('/public-info')) {
   *     return;
   *   }
   *
   *   // All other endpoints require authentication
   *   const apiKey = request.headers.get('X-API-Key');
   *   if (!apiKey || apiKey !== this.env.API_SECRET) {
   *     throw new UnauthorizedError('Invalid API key');
   *   }
   * }
   * ```
   */
  protected checkAuthorization(_request: Request): void {
    // Default: allow all requests
    // Override this method in aggregates to implement authorization logic
  }
}
