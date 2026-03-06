/**
 * DomainEvent - Base interface for all domain events
 *
 * Domain events represent pure business facts that have occurred in the system.
 * They contain ONLY business data - no infrastructure concerns like:
 * - aggregateId (infrastructure - managed by StoredEvent envelope)
 * - version (infrastructure - auto-incremented by base class)
 * - timestamp (infrastructure - auto-set by base class)
 * - orgId (infrastructure - extracted from state or request)
 *
 * Domain events are:
 * - Immutable (use readonly fields)
 * - Focused on business intent
 * - Easy to understand by domain experts
 * - Type-safe with TypeScript literal types
 *
 * @packageDocumentation
 */

/**
 * Base interface for all domain events
 *
 * All domain events must implement this interface.
 * The `type` field uses literal types (via `as const`) to enable:
 * - Discriminated unions
 * - Type-safe pattern matching
 * - Autocomplete in IDEs
 *
 * @example
 * ```typescript
 * export class AccountOpenedEvent implements DomainEvent {
 *   readonly type = 'AccountOpened' as const;
 *
 *   constructor(
 *     public readonly owner: string,
 *     public readonly initialDeposit: number
 *   ) {}
 * }
 * ```
 */
export interface DomainEvent {
  /**
   * Event type discriminator
   *
   * MUST be a string literal type (use `as const`)
   * Used for:
   * - Event handler registration
   * - Type discrimination in unions
   * - Event routing
   */
  readonly type: string;
}

/**
 * Special sentinel value for command handlers to return when no event should be produced.
 *
 * Use this for idempotent commands where the requested state already exists.
 * When a command handler returns NO_EVENT:
 * - No event is persisted to R2
 * - No state change is applied
 * - A success response is returned with the current version
 *
 * @example
 * ```typescript
 * async executeCommand(command: AddKeyCommand, state: LockState) {
 *   // Idempotency check - key already exists
 *   if (state.keys.includes(command.keyId)) {
 *     return NO_EVENT;
 *   }
 *   return { type: 'KeyAdded', data: { keyId: command.keyId } };
 * }
 * ```
 */
export const NO_EVENT = Symbol.for('ceves.NO_EVENT');
