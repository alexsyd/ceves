/**
 * Ceves - Event Sourcing for Cloudflare Workers
 *
 * A decorator-based event sourcing framework built on Cloudflare Workers
 * and Durable Objects. Provides CQRS/ES patterns with automatic state
 * restoration and OpenAPI routing.
 *
 * @packageDocumentation
 */

// Storage interfaces
export type {
  IEventStore,
  ISnapshotStore,
  StoredEvent,
  StoredSnapshot,
} from './storage/interfaces';

// Storage implementations
export { R2EventStore } from './storage/R2EventStore';
export { R2SnapshotStore } from './storage/R2SnapshotStore';
export { D1SnapshotStore } from './storage/D1SnapshotStore';

// Storage errors
export {
  EventStoreError,
  EventWriteError,
  SnapshotStoreError,
  SnapshotWriteError,
  SnapshotCorruptedError,
} from './storage/errors';

// Command schemas
export { BaseCommandSchema } from './schemas/Command';
export type { BaseCommand } from './schemas/Command';

// Event schemas
export { BaseEventSchema } from './schemas/Event';
export type { BaseEvent } from './schemas/Event';

// State types
export { BaseState } from './schemas/State';

// Domain Events
export { NO_EVENT, type DomainEvent } from './events/DomainEvent';

// Event Metadata
export type { EventMetadata } from './events/EventMetadata';

// Tenancy
export type { ITenantResolver } from './tenancy/TenantResolver';
export { HeaderTenantResolver } from './tenancy/HeaderTenantResolver';
export {
  MissingApiKeyError,
  InvalidApiKeyError,
  UnauthorizedAccessError,
} from './tenancy/errors';

// Error classes
export {
  CevesError,
  CommandValidationError,
  EventApplicationError,
  AggregateNotFoundError,
  VersionConflictError,
  BusinessRuleViolationError,
  UnauthorizedError,
  ForbiddenError,
  ZodError,
} from './errors';

// Decorators (Event handlers)
export {
  EventHandler,
  getEventHandlers,
  findEventHandler,
  clearEventHandlers,
  executeSideEffects,
  type IEventHandler,
  type EventHandlerEntry,
} from './decorators';

// State Restoration
export { restoreFromEvents, restoreState } from './restoration';

// DO-First Architecture
export { AggregateObject } from './core/AggregateObject';

// Ceves Routing - Commands and Queries
export { QueryRoute } from './routing/QueryRoute';
export {
  CommandRoute,
  CreateCommandRoute,
  type CommandBody,
  type BaseEvent as CommandRouteEvent,
} from './routing/CommandRoute';

// Routing - Route decorator and registry
export {
  Route,
  getRegisteredRoutes,
  clearRoutes,
  findRouteByUrl,
} from './routing/Route';

export {
  routeRegistry,
  type RouteMetadata,
} from './routing/RouteRegistry';

export type { RouteOptions } from './routing/Route';

export { AggregateRoute } from './routing/AggregateRoute';

export {
  createRouter,
  type RouterOptions,
  type OpenAPIMetadata,
} from './routing/createRouter';

// Re-export Chanfana and Hono for convenience
export { OpenAPIRoute } from 'chanfana';
export type { Context } from 'hono';
export type { Hono } from 'hono';
