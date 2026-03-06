/**
 * Command Schema Definitions for Ceves Event Sourcing Library
 *
 * This module provides Zod-based schema validation for commands with TypeScript type inference.
 * Commands are validated both at runtime (via Zod) and compile-time (via TypeScript).
 *
 * Key Design Decisions:
 * - Base command schema enforces aggregateType and aggregateId (required for event sourcing)
 * - z.infer<> ensures TypeScript types stay synchronized with runtime schemas
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * Base schema for all commands in the event sourcing system.
 *
 * Every command must include:
 * - `aggregateType`: Identifies the type of aggregate (e.g., "account", "order")
 * - `aggregateId`: Unique identifier for the specific aggregate instance
 *
 * These fields are required for routing commands to the correct aggregate and
 * ensuring events are persisted to the correct event stream.
 *
 * @example
 * ```typescript
 * const validCommand = {
 *   aggregateType: 'account',
 *   aggregateId: 'acc-123'
 * };
 *
 * const result = BaseCommandSchema.parse(validCommand); // ✓ Success
 * ```
 *
 * @example
 * ```typescript
 * const invalidCommand = {
 *   aggregateType: '',
 *   aggregateId: 'acc-123'
 * };
 *
 * BaseCommandSchema.parse(invalidCommand); // ✗ Throws ZodError: "Aggregate type is required"
 * ```
 */
export const BaseCommandSchema = z.object({
  aggregateType: z.string().min(1, 'Aggregate type is required'),
  aggregateId: z.string().min(1, 'Aggregate ID is required'),
});

/**
 * TypeScript type for base command structure.
 *
 * Inferred from {@link BaseCommandSchema} to ensure type safety.
 * Use this type for function parameters and return values when working with base commands.
 *
 * @example
 * ```typescript
 * function processCommand(cmd: BaseCommand) {
 *   console.log(`Processing ${cmd.aggregateType}/${cmd.aggregateId}`);
 * }
 * ```
 */
export type BaseCommand = z.infer<typeof BaseCommandSchema>;

