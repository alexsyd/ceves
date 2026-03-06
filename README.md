# Ceves - Multi-Cloud Event Sourcing

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-orange)](https://aws.amazon.com/lambda/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Ceves** is a multi-cloud event sourcing library that works on both Cloudflare Workers (R2/D1) and AWS Lambda (S3). Write your domain logic once, deploy anywhere. Built with TypeScript-first design, decorator-based patterns, and automatic state restoration.

## Why Ceves?

Event sourcing typically requires weeks of infrastructure work: event stores, snapshot management, state restoration, and testing setup. Ceves handles all of that for you:

- **Zero Infrastructure Code** - Write only domain logic (commands, events, state)
- **Automatic State Persistence** - State persists to Durable Objects storage (Cloudflare) or S3 snapshots (AWS)
- **Zero-Latency State** - Cloudflare DOs use built-in transactional storage (no network calls)
- **Multi-Cloud Support** - Deploy to Cloudflare Workers or AWS Lambda with zero code changes
- **Superior DX** - Local testing with Wrangler (no LocalStack pain), TypeScript-first, decorator-based
- **Serverless Economics** - True pay-per-use pricing on both platforms
- **Production Ready** - Battle-tested patterns proven in production systems

## Installation

```bash
# Using pnpm (recommended)
pnpm add ceves

# Using npm
npm install ceves
```

For AWS Lambda support:
```bash
pnpm add @aws-sdk/client-s3 @types/aws-lambda
```

## Quick Start

Build your first event-sourced bank account in 5 minutes:

```typescript
import { CevesApp, R2EventStore, D1SnapshotStore } from 'ceves';

// 1. Define your state
interface BankAccountState extends BaseState {
  balance: number;
}

// 2. Define commands & events
class DepositCommand extends BaseCommand { /* ... */ }
class MoneyDepositedEvent extends BaseEvent {
  apply(state: BankAccountState) {
    return { ...state, balance: state.balance + this.amount };
  }
}

// 3. Create handler
@CommandHandler
class DepositHandler {
  handle(cmd: DepositCommand) {
    return [new MoneyDepositedEvent(cmd)];
  }
}

// 4. Use it!
const app = new CevesApp({
  eventStore: new R2EventStore(env.EVENTS),
  snapshotStore: new D1SnapshotStore(env.DB),
});

const state = await app.execute(depositCommand);
```

**→ [Full Getting Started Guide](./GETTING_STARTED.md)** for complete walkthrough

See the complete working example in [`/example`](./example/README.md) with full BankAccount domain implementation.

## Examples

### Cloudflare Workers
See [`/example`](./example/README.md) for a complete Cloudflare Workers example:
- BankAccount domain (Open, Deposit, Withdraw)
- Full command and event handlers
- Comprehensive test suite
- Wrangler configuration
- Local development setup

### AWS Lambda
See [`/example-lambda`](./example-lambda/README.md) for a complete AWS Lambda example:
- Same BankAccount domain logic (zero changes!)
- S3 storage for events and snapshots
- SAM template for infrastructure
- API Gateway integration

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Build library
pnpm run build

# Generate API docs
pnpm run docs
```

## Core Concepts

- **Commands**: Express intent to change state (validated, can fail)
- **Events**: Immutable facts that happened (stored forever)
- **State**: Derived by replaying events through `apply()` methods
- **Aggregate**: A cluster of domain objects treated as a single unit
- **Event Store**: Append-only log of all events (R2 or S3)
- **State Persistence**:
  - **Cloudflare Durable Objects**: Built-in transactional storage (zero-latency, no snapshots needed)
  - **AWS Lambda**: S3 snapshots for fast state restoration
  - **CevesApp (stateless)**: Optional D1 or S3 snapshots

## Migration Guide: Domain Event Pattern (v0.2.0+)

**TL;DR**: Event handlers now receive pure domain events + metadata separately. Command handlers return domain event instances instead of plain objects. Infrastructure fields (version, orgId, timestamp) are auto-managed by the framework.

### What Changed?

Ceves v0.2.0 introduces a cleaner separation between domain logic and infrastructure concerns (ADR-008):

- **Domain Events**: Pure TypeScript classes containing only business data
- **StoredEvent**: Infrastructure envelope that wraps domain events with metadata
- **Event Handlers**: Receive domain event + metadata as separate parameters
- **Command Handlers**: Return domain event instances (not plain objects)

### Migrating Event Handlers

**Before (v0.1.x):**
```typescript
@EventHandler({
  eventType: 'AccountOpened',
  aggregateType: 'account'
})
export class AccountOpenedHandler implements IEventHandler<AccountState, StoredEvent> {
  apply(state: AccountState | null, event: StoredEvent): AccountState {
    return {
      id: event.aggregateId,           // Infrastructure field
      owner: event.data.owner,          // Business data nested in .data
      balance: event.data.initialDeposit,
      version: event.version,           // Manual version tracking
      timestamp: event.timestamp,       // Manual timestamp
      orgId: event.orgId                // Manual orgId
    };
  }
}
```

**After (v0.2.0+):**
```typescript
// 1. Create domain event class
export class AccountOpenedEvent implements DomainEvent {
  readonly type = 'AccountOpened' as const;

  constructor(
    public readonly owner: string,
    public readonly initialDeposit: number
  ) {}
}

// 2. Update event handler
@EventHandler({
  eventType: 'AccountOpened',
  aggregateType: 'account'
})
export class AccountOpenedHandler implements IEventHandler<AccountState, AccountOpenedEvent> {
  apply(
    state: AccountState | null,
    event: AccountOpenedEvent,         // Pure domain event
    metadata: EventMetadata            // Infrastructure metadata
  ): Omit<AccountState, 'version' | 'orgId'> {  // Return WITHOUT version/orgId
    return {
      id: metadata.aggregateId,        // From metadata
      owner: event.owner,               // Direct property access
      balance: event.initialDeposit,    // Direct property access
      timestamp: metadata.timestamp     // From metadata
      // version & orgId auto-set by framework
    };
  }
}
```

**Key Changes:**
- `apply()` now takes 3 parameters: `(state, event, metadata)`
- Access event data directly (not through `.data`)
- Return state WITHOUT `version` and `orgId` (framework adds them)
- Use `EventMetadata` for infrastructure fields

### Migrating Command Handlers

**Before (v0.1.x):**
```typescript
@CommandHandler({ route: '/accounts/:id/open', ... })
export class OpenAccountHandler extends OpenAPIRoute {
  async executeCommand(command: OpenAccountCommand, state: AccountState | null) {
    if (state !== null) throw new Error('Account exists');

    return {
      type: 'AccountOpened',
      data: {                            // Business data nested
        owner: command.owner,
        initialDeposit: command.initialDeposit
      }
    };
  }
}
```

**After (v0.2.0+):**
```typescript
@CommandHandler({ route: '/accounts/:id/open', ... })
export class OpenAccountHandler extends CommandRoute<
  OpenAccountCommand,
  AccountState,
  AccountOpenedEvent    // Specify domain event type
> {
  async executeCommand(
    command: OpenAccountCommand,
    state: AccountState | null
  ): Promise<AccountOpenedEvent> {    // Return domain event instance
    if (state !== null) throw new Error('Account exists');

    // Return pure domain event instance (no infrastructure fields)
    return new AccountOpenedEvent(command.owner, command.initialDeposit);
  }
}
```

**Key Changes:**
- Extend `CommandRoute<TCommand, TState, TEvent>` instead of `OpenAPIRoute`
- Return domain event instances (not plain objects)
- No need to set aggregateId, version, timestamp, orgId (framework adds them)

### Benefits

1. **Clean Domain Logic**: Business logic contains only business concepts
2. **Type Safety**: Full TypeScript support with discriminated unions
3. **Less Boilerplate**: No manual version/orgId/timestamp tracking
4. **Better Testing**: Test pure domain logic without infrastructure concerns
5. **Consistent Architecture**: Clear separation of concerns (DDD principles)

### Example: Complete Migration

See [`/example/src/events`](./example/src/events) for complete working examples:
- Domain event classes: `AccountOpenedEvent.ts`, `MoneyDepositedEvent.ts`
- Event handlers: `AccountOpenedHandler.ts`, `MoneyDepositedHandler.ts`
- Command handlers: `OpenAccountHandler.ts`, `DepositHandler.ts`
- Tests: All test files demonstrate the new pattern

## Documentation

- **Cloudflare Workers**: [example/README.md](./example/README.md)
- **AWS Lambda**: [example-lambda/README.md](./example-lambda/README.md)
- **AWS Deployment Guide**: [docs/AWS_LAMBDA_GUIDE.md](./docs/AWS_LAMBDA_GUIDE.md)
- **AWS Architecture**: [docs/aws-lambda-architecture.md](./docs/aws-lambda-architecture.md)

## QueryHandler Decorator (v0.3.0+)

Ceves now supports read-only queries via the `@QueryHandler` decorator. Queries enable efficient, type-safe access to aggregate state without mutations or event emissions.

### Quick Example

```typescript
import { z } from 'zod';
import { QueryHandler, IQueryHandler } from 'ceves';

// Define query handler as standalone class
@QueryHandler
export class GetBalanceQuery implements IQueryHandler<BankAccountState, {}, BalanceResponse> {
  queryType = 'GetBalance';
  aggregateType = 'BankAccountAggregate';
  route = '/accounts/:id/balance';
  method = 'GET' as const;
  summary = 'Get account balance';
  responses = {
    200: z.object({
      balance: z.number(),
      currency: z.string()
    })
  };

  // Read-only execution (no state mutations, no events)
  async execute(state: BankAccountState, _query: {}): Promise<BalanceResponse> {
    return {
      balance: state.balance,
      currency: 'USD'
    };
  }
}
```

### Usage

```bash
# Register query in worker entry point
import './queries/GetBalanceQuery';

# HTTP Request
GET /accounts/acc-123/balance

# Response
{
  "balance": 1000,
  "currency": "USD"
}
```

### Commands vs Queries

| Aspect | CommandHandler | QueryHandler |
|--------|---------------|--------------|
| **Purpose** | Write (mutate state) | Read (query state) |
| **Pattern** | Methods on aggregates | Standalone classes |
| **HTTP Method** | POST (default) | GET (default) |
| **Events** | Emits events | Never emits |
| **State** | Can mutate | Read-only |

### Features

- **Read-only operations**: Never mutate state or emit events
- **Standalone classes**: Follow EventHandler pattern (not methods)
- **GET by default**: Use HTTP GET (or POST for complex queries)
- **DO-first routing**: RouterWorker → Durable Object → query class
- **Query parameters**: Full Zod validation support
- **OpenAPI docs**: Automatic documentation generation
- **Type-safe**: Full TypeScript generics

### Learn More

**Complete guide with examples:** [docs/QUERY_HANDLER_GUIDE.md](./docs/QUERY_HANDLER_GUIDE.md)

**Example queries:**
- Simple query: [src/examples/queries/GetBalanceQuery.ts](./src/examples/queries/GetBalanceQuery.ts)
- With pagination: [src/examples/queries/ListTransactionsQuery.ts](./src/examples/queries/ListTransactionsQuery.ts)
- Unscoped query: [src/examples/queries/HealthCheckQuery.ts](./src/examples/queries/HealthCheckQuery.ts)

