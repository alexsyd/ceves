/**
 * Event Schema Definitions for Ceves Event Sourcing Library
 *
 * This module provides Zod-based schema validation for events with TypeScript type inference.
 * Events are validated both at runtime (via Zod) and compile-time (via TypeScript), and include
 * mandatory apply() methods for functional state transformation.
 *
 * Key Design Decisions:
 * - Base event schema enforces aggregateType, aggregateId, version, and timestamp fields
 * - defineEvent() helper requires an apply() method for state transformation
 * - apply() methods are pure functions: (state | null, event) => state
 * - Functional patterns over OOP: events transform state immutably
 * - z.infer<> ensures TypeScript types stay synchronized with runtime schemas
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * Base schema for all events in the event sourcing system.
 *
 * Every event must include:
 * - `aggregateType`: Identifies the type of aggregate (e.g., "account", "order")
 * - `aggregateId`: Unique identifier for the specific aggregate instance
 * - `version`: Sequential event number (positive integer) for ordering and conflict detection
 * - `timestamp`: ISO 8601 datetime string indicating when the event occurred
 *
 * These fields are required for event ordering, aggregate identification,
 * and ensuring events are persisted to the correct event stream.
 *
 * @example
 * ```typescript
 * const validEvent = {
 *   aggregateType: 'account',
 *   aggregateId: 'acc-123',
 *   version: 1,
 *   timestamp: '2025-11-15T10:00:00Z'
 * };
 *
 * const result = BaseEventSchema.parse(validEvent); // ✓ Success
 * ```
 *
 * @example
 * ```typescript
 * const invalidEvent = {
 *   aggregateType: 'account',
 *   aggregateId: 'acc-123',
 *   version: 0,  // Must be positive!
 *   timestamp: '2025-11-15T10:00:00Z'
 * };
 *
 * BaseEventSchema.parse(invalidEvent); // ✗ Throws ZodError: version must be positive
 * ```
 */
export const BaseEventSchema = z.object({
  aggregateType: z.string().min(1, 'Aggregate type is required'),
  aggregateId: z.string().min(1, 'Aggregate ID is required'),
  version: z.number().int().positive(),
  timestamp: z.string().datetime(),
});

/**
 * TypeScript type for base event structure.
 *
 * Inferred from {@link BaseEventSchema} to ensure type safety.
 * Use this type for function parameters and return values when working with base events.
 *
 * @example
 * ```typescript
 * function processEvent(event: BaseEvent) {
 *   console.log(`Event v${event.version} for ${event.aggregateType}/${event.aggregateId}`);
 * }
 * ```
 */
export type BaseEvent = z.infer<typeof BaseEventSchema>;

/**
 * Create an event definition with schema validation and state transformation logic.
 *
 * This helper function:
 * 1. Extends {@link BaseEventSchema} with custom event-specific data fields
 * 2. Adds a `type` literal for runtime type discrimination
 * 3. Requires an apply() method for functional state transformation
 * 4. Returns an object with { schema, apply, eventType } for use in event handlers
 *
 * The returned schema includes:
 * - `aggregateType` and `aggregateId` from {@link BaseEventSchema}
 * - `version` and `timestamp` from {@link BaseEventSchema}
 * - Custom data fields from the provided dataSchema
 * - `type` as a string literal for type safety and discrimination
 *
 * The apply() method:
 * - Receives current state (null for first event) and validated event
 * - Returns new state object (immutable transformation)
 * - Is a pure function with no side effects
 * - State.version should equal event.version after transformation
 *
 * @template TData - Zod schema shape for event-specific data fields
 * @template TState - TypeScript type for the aggregate state
 * @param eventType - String literal identifying the event type (e.g., "AccountCreated")
 * @param dataSchema - Zod object schema defining event-specific data fields
 * @param applyFn - Pure function transforming state based on event data
 * @returns Object with schema for validation, apply for state transformation, and eventType
 *
 * @example
 * ```typescript
 * // Define an AccountCreated event
 * const AccountCreatedEvent = defineEvent(
 *   'AccountCreated',
 *   z.object({
 *     email: z.string().email(),
 *     name: z.string().min(1),
 *   }),
 *   (state: AccountState | null, event) => ({
 *     id: event.aggregateId,
 *     email: event.email,
 *     name: event.name,
 *     balance: 0,
 *     version: event.version,
 *     createdAt: event.timestamp,
 *   })
 * );
 *
 * type AccountState = {
 *   id: string;
 *   email: string;
 *   name: string;
 *   balance: number;
 *   version: number;
 *   createdAt: string;
 * };
 *
 * // Runtime validation
 * const eventData = {
 *   aggregateType: 'account',
 *   aggregateId: 'acc-123',
 *   type: 'AccountCreated',
 *   version: 1,
 *   timestamp: '2025-11-15T10:00:00Z',
 *   email: 'alice@example.com',
 *   name: 'Alice'
 * };
 *
 * const validatedEvent = AccountCreatedEvent.schema.parse(eventData); // ✓ Success
 * const newState = AccountCreatedEvent.apply(null, validatedEvent);
 * // Result: {
 * //   id: 'acc-123',
 * //   email: 'alice@example.com',
 * //   name: 'Alice',
 * //   balance: 0,
 * //   version: 1,
 * //   createdAt: '2025-11-15T10:00:00Z'
 * // }
 * ```
 *
 * @example
 * ```typescript
 * // Define a MoneyDeposited event
 * const MoneyDepositedEvent = defineEvent(
 *   'MoneyDeposited',
 *   z.object({
 *     amount: z.number().positive(),
 *   }),
 *   (state: AccountState | null, event) => {
 *     if (!state) {
 *       throw new Error('Cannot deposit money before account is created');
 *     }
 *     return {
 *       ...state,
 *       balance: state.balance + event.amount,
 *       version: event.version,
 *     };
 *   }
 * );
 *
 * // Apply to existing state
 * const currentState = {
 *   id: 'acc-123',
 *   email: 'alice@example.com',
 *   name: 'Alice',
 *   balance: 100,
 *   version: 1,
 *   createdAt: '2025-11-15T10:00:00Z'
 * };
 *
 * const depositEvent = {
 *   aggregateType: 'account',
 *   aggregateId: 'acc-123',
 *   type: 'MoneyDeposited',
 *   version: 2,
 *   timestamp: '2025-11-15T10:05:00Z',
 *   amount: 50
 * };
 *
 * const validatedDeposit = MoneyDepositedEvent.schema.parse(depositEvent);
 * const newState = MoneyDepositedEvent.apply(currentState, validatedDeposit);
 * // Result: { ...currentState, balance: 150, version: 2 }
 * // Original currentState unchanged (immutable transformation)
 * ```
 */
export function defineEvent<TData extends z.ZodRawShape, TState>(
  eventType: string,
  dataSchema: z.ZodObject<TData>,
  applyFn: (
    state: TState | null,
    event: z.infer<typeof dataSchema> & BaseEvent
  ) => TState
) {
  const schema = BaseEventSchema.extend({
    type: z.literal(eventType),
  }).extend(dataSchema.shape);

  return {
    schema,
    apply: applyFn,
    eventType,
  };
}
