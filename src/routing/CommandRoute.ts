/**
 * CommandRoute - Base class for command routes that forward to Durable Objects
 * 
 * Handles:
 * - Extracting aggregate ID from URL path
 * - Getting DO stub from environment
 * - Injecting auth headers from Hono context
 * - Forwarding request to Durable Object
 */

import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import type { DurableObjectNamespace, DurableObjectStub } from '@cloudflare/workers-types';
import { NO_EVENT } from '../events/DomainEvent';

/**
 * Auth context stored in Hono context via middleware
 */
interface AuthContext {
  authType: 'api-key' | 'jwt';
  orgId?: string;
  isSuper?: boolean;
  userEmail?: string;
  userId?: string;
}

/**
 * Command body type - commands are just the body fields from the request
 *
 * Using Record<string, unknown> because:
 * - Commands are always objects (request body)
 * - aggregateId comes from URL params, not body
 * - State contains entity identifiers (lockId, uuid, etc.)
 *
 * Define your command type from Zod:
 * ```typescript
 * const MyBodySchema = z.object({ ... });
 * type MyBody = z.infer<typeof MyBodySchema>;  // Use this as TCommand
 * ```
 */
export type CommandBody = Record<string, unknown>;

/**
 * Base event interface - all events must have a type field
 *
 * Note: This is a plain TypeScript interface, not a Zod schema.
 * Events are produced by executeCommand(), not from external input,
 * so runtime validation is not needed at this level.
 */
export interface BaseEvent {
  type: string;
}

/**
 * Event result type - can be a domain event or NO_EVENT sentinel
 *
 * Command handlers can return NO_EVENT to indicate that no event should be
 * persisted (e.g., for idempotent commands where the state already matches).
 */
export type EventResult<TEvent extends BaseEvent = BaseEvent> = TEvent | typeof NO_EVENT;

/**
 * Abstract base class for UPDATE command routes with full type safety
 *
 * Use this for commands that modify EXISTING aggregates. The state parameter
 * is guaranteed to be non-null because the framework validates the aggregate
 * exists before calling executeCommand().
 *
 * For CREATE commands (new aggregates), use CreateCommandRoute instead.
 *
 * Commands are forwarded to Durable Objects where they execute with:
 * - Ordered execution (single-threaded in DO)
 * - Transactional state updates
 * - No race conditions
 *
 * @template TCommand - Command type (body fields, derived from Zod schema)
 * @template TState - Aggregate state type (NEVER null for update commands)
 * @template TEvent - Domain event type (must extend BaseEvent)
 *
 * Usage:
 * ```typescript
 * const AddKeyBodySchema = z.object({
 *   keyUuid: z.string().uuid(),
 *   keyIndexNumber: z.number().int().optional(),
 * });
 * type AddKeyBody = z.infer<typeof AddKeyBodySchema>;
 *
 * @Route({ method: 'POST', path: '/locks/:id/AddKey' })
 * export class AddKeyRoute extends CommandRoute<AddKeyBody, LockState, KeyAddedEventData> {
 *   aggregateType = 'LockAggregate';
 *   schema = { request: { body: { content: { 'application/json': { schema: AddKeyBodySchema } } } } };
 *
 *   async executeCommand(command: AddKeyBody, state: LockState): Promise<KeyAddedEventData> {
 *     // state is NEVER null - framework guarantees aggregate exists
 *     return { type: EventTypes.KEY_ADDED, lockId: state.lockId, keyUuid: command.keyUuid };
 *   }
 * }
 * ```
 */
export abstract class CommandRoute<
  TCommand extends CommandBody = CommandBody,
  TState = unknown,
  TEvent extends BaseEvent | typeof NO_EVENT = BaseEvent
> extends OpenAPIRoute {
  /**
   * Indicates this is an update command (aggregate must exist)
   * Framework uses this to validate semantics before execution
   */
  static readonly isCreateCommand: boolean = false;

  /**
   * Aggregate type - must match DO binding name
   * Example: 'LockAggregate' maps to LOCK binding
   */
  abstract aggregateType: string;

  /**
   * Build command object from request body
   *
   * Commands are just the body fields - aggregateId comes from URL params
   * and is handled by the base class for DO routing.
   *
   * Uses Chanfana's `getValidatedData()` for full Zod validation including:
   * - Type validation
   * - Zod refinements (.refine(), .superRefine())
   * - Custom validators
   *
   * Override this method if you need custom command building logic.
   *
   * @param _c - Hono context (unused, kept for override compatibility)
   * @returns Command object (body fields only)
   */
  async buildCommand(_c: Context): Promise<TCommand> {
    // Use Chanfana's validation which applies all Zod refinements
    const data = await this.getValidatedData<typeof this.schema>();
    return (data.body ?? {}) as unknown as TCommand;
  }

  /**
   * Execute command business logic and produce domain event
   *
   * This method contains the command's business logic. It validates business rules
   * and produces a domain event describing what happened.
   *
   * For UPDATE commands (this class), state is NEVER null - the framework
   * guarantees the aggregate exists before calling this method.
   *
   * @param command - Command object (from buildCommand)
   * @param state - Current aggregate state (NEVER null for update commands)
   * @param env - Environment bindings (from Durable Object)
   * @returns Domain event to apply
   */
  abstract executeCommand(command: TCommand, state: TState, env: unknown): Promise<TEvent>;
  /**
   * Main handler - validates request and forwards to Durable Object
   *
   * Request validation happens here (before DO forwarding) to:
   * 1. Catch invalid requests early (before DO instantiation)
   * 2. Apply Zod refinements and custom validators
   * 3. Ensure only valid data reaches the DO
   *
   * The DO is responsible for:
   * 1. Looking up the handler class from registry
   * 2. Loading/ensuring state
   * 3. Validating create/update semantics
   * 4. Executing the command via handler.executeCommand()
   * 5. Applying event and persisting state
   *
   * This ensures ordered execution and transactionality within the DO.
   */
  override async handle(c: Context): Promise<Response> {
    // Extract aggregate ID from path
    const aggregateId = c.req.param('id');

    if (!aggregateId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'MissingAggregateId',
          message: 'Aggregate ID not found in URL path',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Backward compatibility: unwrap legacy `payload` wrapper before Zod validation.
    // Old format:  { commandType, aggregateId, payload: { ...fields } }
    // New format:  { ...fields }  (flat, what Zod schemas expect)
    // Reading the body here consumes the ReadableStream, so we must replace
    // c.req.raw with a new Request containing the (possibly unwrapped) body
    // before getValidatedData() reads it.
    const contentType = c.req.raw.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        const unwrappedBody = await this.unwrapLegacyPayload(c);

        // Replace c.req.raw so that getValidatedData() reads the unwrapped body
        const newHeaders = new Headers(c.req.raw.headers);
        c.req.raw = new Request(c.req.raw.url, {
          method: c.req.raw.method,
          headers: newHeaders,
          body: JSON.stringify(unwrappedBody),
        });
      } catch (e) {
        return c.json({ success: false, errors: [{ code: 400, message: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }] }, 400);
      }
    }

    // Validate request body using Zod schema BEFORE forwarding to DO
    // This consumes the request body ReadableStream, so we must rebuild the request afterward
    // Note: Chanfana's execute() wrapper catches ZodErrors and returns 400 responses,
    // so validation errors are automatically handled
    const validatedData = await this.getValidatedData<typeof this.schema>();

    // Get DO stub
    const stub = this.getDurableObjectStub(c, aggregateId);

    // Prepare request with auth headers
    const headers = this.buildAuthHeaders(c);

    // Forward validated data to DO
    // Build new request with validated body (original ReadableStream was consumed by validation)
    const forwardRequest = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers: headers,
      body: validatedData.body ? JSON.stringify(validatedData.body) : undefined,
    });

    return await stub.fetch(forwardRequest);
  }

  /**
   * Build headers with auth context injected for forwarding to Durable Object.
   *
   * @param c - Hono context with auth context
   * @returns Headers with auth fields set
   */
  private buildAuthHeaders(c: Context): Headers {
    const headers = new Headers(c.req.raw.headers);
    const authContext = c.get('authContext') as AuthContext | undefined;

    if (!authContext) {
      return headers;
    }

    if (authContext.authType === 'api-key' && authContext.orgId) {
      headers.set('X-Org-Id', authContext.orgId);
      if (authContext.isSuper) {
        headers.set('X-Super-Access', 'true');
      }
    }

    if (authContext.authType === 'jwt') {
      if (authContext.userEmail) {
        headers.set('X-User-Email', authContext.userEmail);
      }
      if (authContext.userId) {
        headers.set('X-User-Id', authContext.userId);
      }
    }

    return headers;
  }

  /**
   * Unwrap legacy `payload` wrapper from request body.
   *
   * Old format:  { commandType, aggregateId, payload: { ...fields } }
   * New format:  { ...fields }  (flat, what Zod schemas expect)
   *
   * @param c - Hono context
   * @returns Unwrapped body as a plain object
   */
  private async unwrapLegacyPayload(c: Context): Promise<Record<string, unknown>> {
    const rawBody: unknown = await c.req.raw.json();
    if (
      typeof rawBody === 'object' &&
      rawBody !== null &&
      'payload' in rawBody &&
      typeof (rawBody as Record<string, unknown>).payload === 'object' &&
      (rawBody as Record<string, unknown>).payload !== null
    ) {
      return (rawBody as Record<string, unknown>).payload as Record<string, unknown>;
    }
    return typeof rawBody === 'object' && rawBody !== null
      ? (rawBody as Record<string, unknown>)
      : {};
  }

  /**
   * Get Durable Object stub from environment
   *
   * @param c - Hono context with env bindings
   * @param aggregateId - Aggregate ID for DO routing
   * @returns Durable Object stub
   */
  protected getDurableObjectStub(c: Context, aggregateId: string): DurableObjectStub {
    const binding = this.aggregateTypeToBinding(this.aggregateType);
    const env = c.env as Record<string, unknown>;
    const namespace = env[binding] as DurableObjectNamespace;

    if (!namespace) {
      throw new Error(
        `Durable Object namespace "${binding}" not found in environment. ` +
          `Check wrangler.jsonc has [[durable_objects.bindings]] with binding = "${binding}"`
      );
    }

    const id = namespace.idFromName(aggregateId);
    return namespace.get(id);
  }

  /**
   * Convert aggregate type to DO binding name
   *
   * Examples:
   * - 'UserAggregate' → 'USER'
   * - 'LockAggregate' → 'LOCK'
   * - 'HubAggregate' → 'HUB'
   *
   * @param aggregateType - Aggregate type name
   * @returns Uppercase snake_case binding name
   */
  private aggregateTypeToBinding(aggregateType: string): string {
    const snakeCase = aggregateType.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();

    // Remove '_AGGREGATE' suffix if present
    return snakeCase.replace(/_AGGREGATE$/, '');
  }
}

/**
 * Abstract base class for CREATE command routes
 *
 * Use this for commands that CREATE NEW aggregates. The state parameter
 * is always null because create commands run against non-existent aggregates.
 *
 * For UPDATE commands (existing aggregates), use CommandRoute instead.
 *
 * Commands are forwarded to Durable Objects where they execute with:
 * - Ordered execution (single-threaded in DO)
 * - Transactional state updates
 * - No race conditions
 *
 * @template TCommand - Command type (body fields, derived from Zod schema)
 * @template TState - Aggregate state type (for typing the returned event)
 * @template TEvent - Domain event type (must extend BaseEvent)
 *
 * Usage:
 * ```typescript
 * const CreateUserBodySchema = z.object({
 *   email: z.string().email(),
 *   name: z.string().optional(),
 * });
 * type CreateUserBody = z.infer<typeof CreateUserBodySchema>;
 *
 * @Route({ method: 'POST', path: '/users/:id/CreateUser' })
 * export class CreateUserRoute extends CreateCommandRoute<CreateUserBody, UserState, UserCreatedEvent> {
 *   aggregateType = 'UserAggregate';
 *   schema = { request: { body: { content: { 'application/json': { schema: CreateUserBodySchema } } } } };
 *
 *   async executeCommand(command: CreateUserBody): Promise<UserCreatedEvent> {
 *     // state is always null for create commands - no need to check
 *     return { type: 'UserCreated', email: command.email, name: command.name };
 *   }
 * }
 * ```
 */
export abstract class CreateCommandRoute<
  TCommand extends CommandBody = CommandBody,
  TState = unknown,
  TEvent extends BaseEvent | typeof NO_EVENT = BaseEvent
> extends CommandRoute<TCommand, TState, TEvent> {
  /**
   * Indicates this is a create command (aggregate must NOT exist)
   * Framework uses this to validate semantics before execution
   */
  static override readonly isCreateCommand = true;

  /**
   * Execute create command business logic and produce domain event
   *
   * For CREATE commands, state is always null (guaranteed by framework).
   * No state parameter needed since create commands don't have prior state.
   *
   * @param command - Command object (from buildCommand)
   * @param env - Environment bindings (from Durable Object)
   * @returns Domain event to apply
   */
  abstract override executeCommand(command: TCommand, env: unknown): Promise<TEvent>;
}
