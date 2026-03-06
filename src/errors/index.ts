/**
 * Error Definitions for Ceves Event Sourcing Library
 *
 * This module provides typed error classes for common failure scenarios in event sourcing.
 * All library-specific errors extend the base CevesError class for consistent error handling.
 *
 * @packageDocumentation
 */

export { CevesError } from './CevesError';
export { CommandValidationError } from './CommandValidationError';
export { EventApplicationError } from './EventApplicationError';
export { AggregateNotFoundError } from './AggregateNotFoundError';
export { VersionConflictError } from './VersionConflictError';
export { VersionMismatchError } from './VersionMismatchError';
export { BusinessRuleViolationError } from './BusinessRuleViolationError';
export { UnauthorizedError } from './UnauthorizedError';
export { ForbiddenError } from './ForbiddenError';

/**
 * Re-export ZodError for convenience.
 *
 * ZodError is thrown when schema validation fails (e.g., invalid command or event data).
 * Re-exporting it here provides a single import location for all Ceves errors.
 */
export { ZodError } from 'zod';
