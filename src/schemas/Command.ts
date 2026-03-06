/**
 * Command Schema Definitions for Ceves Event Sourcing Library
 *
 * This module provides Zod-based schema validation for commands with TypeScript type inference.
 * Commands are validated both at runtime (via Zod) and compile-time (via TypeScript).
 *
 * Key Design Decisions:
 * - Base command schema enforces aggregateType and aggregateId (required for event sourcing)
 * - defineCommand() helper simplifies creating command schemas with type-safe validation
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

/**
 * Create a command schema with custom fields and automatic type inference.
 *
 * This helper function:
 * 1. Extends {@link BaseCommandSchema} with custom fields
 * 2. Adds a `commandType` literal for runtime type discrimination
 * 3. Returns a Zod schema with full TypeScript type inference
 *
 * The returned schema includes:
 * - `aggregateType` and `aggregateId` from {@link BaseCommandSchema}
 * - Custom fields from the provided schema
 * - `commandType` as a string literal for type safety
 *
 * @template T - Zod schema shape for custom command fields
 * @param commandType - String literal identifying the command type (e.g., "CreateAccount")
 * @param schema - Zod schema object defining custom fields for this command
 * @returns Combined Zod schema ready for validation and type inference
 *
 * @example
 * ```typescript
 * const CreateAccountCommand = defineCommand('CreateAccount', {
 *   email: z.string().email(),
 *   name: z.string().min(1),
 * });
 *
 * type CreateAccountCommand = z.infer<typeof CreateAccountCommand>;
 * // Result: {
 * //   aggregateType: string;
 * //   aggregateId: string;
 * //   commandType: 'CreateAccount';  // Literal type!
 * //   email: string;
 * //   name: string;
 * // }
 *
 * // Runtime validation
 * const validCommand = CreateAccountCommand.parse({
 *   aggregateType: 'account',
 *   aggregateId: 'acc-123',
 *   commandType: 'CreateAccount',
 *   email: 'alice@example.com',
 *   name: 'Alice'
 * }); // ✓ Success
 *
 * // Compile-time type safety
 * const cmd: CreateAccountCommand = {
 *   aggregateType: 'account',
 *   aggregateId: 'acc-123',
 *   commandType: 'CreateAccount',
 *   email: 'alice@example.com',
 *   name: 'Alice'
 * }; // ✓ TypeScript validates this
 * ```
 *
 * @example
 * ```typescript
 * // Invalid command fails validation
 * const DepositMoneyCommand = defineCommand('DepositMoney', {
 *   amount: z.number().positive(),
 * });
 *
 * DepositMoneyCommand.parse({
 *   aggregateType: 'account',
 *   aggregateId: '',  // Empty string!
 *   commandType: 'DepositMoney',
 *   amount: 100
 * }); // ✗ Throws ZodError: "Aggregate ID is required"
 * ```
 */
export function defineCommand<T extends z.ZodRawShape>(
  commandType: string,
  schema: T
) {
  return BaseCommandSchema.extend(schema).extend({
    commandType: z.literal(commandType),
  });
}
