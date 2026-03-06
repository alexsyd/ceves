/**
 * Event Schema Definitions for Ceves Event Sourcing Library
 *
 * This module provides Zod-based schema validation for events with TypeScript type inference.
 * Events are validated both at runtime (via Zod) and compile-time (via TypeScript).
 *
 * Key Design Decisions:
 * - Base event schema enforces aggregateType, aggregateId, version, and timestamp fields
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

