# Ceves - Event Sourcing for Cloudflare Workers

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Ceves** (Command/Event/View/Entity/State) is an event sourcing framework for Cloudflare Workers and Durable Objects. Write your domain logic once, get automatic state persistence, OpenAPI docs, and zero-latency reads. Built with TypeScript-first design and decorator-based patterns.

## Why Ceves?

Event sourcing typically requires weeks of infrastructure work: event stores, snapshot management, state restoration, and testing setup. Ceves handles all of that:

- **Zero Infrastructure Code** - Write only domain logic (commands, events, state)
- **Zero-Latency State** - Durable Objects use built-in transactional storage (no network calls)
- **Automatic OpenAPI** - Routes generate OpenAPI docs and Swagger UI automatically
- **Superior DX** - Local testing with Wrangler, TypeScript-first, decorator-based
- **Serverless Economics** - True pay-per-use pricing on Cloudflare Workers
- **Production Ready** - Battle-tested patterns proven in production systems

## Installation

```bash
npm install ceves
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

**[Full Getting Started Guide](./GETTING_STARTED.md)** for complete walkthrough.

See the complete working example in [`/example`](./example/README.md) with full BankAccount domain implementation.

## Example

See [`/example`](./example/README.md) for a complete Cloudflare Workers example:
- BankAccount domain (Open, Deposit, Withdraw)
- Full command and event handlers
- Comprehensive test suite
- Wrangler configuration
- Local development setup

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build library
npm run build

# Generate API docs
npm run docs
```

## Core Concepts

- **Commands**: Express intent to change state (validated, can fail)
- **Events**: Immutable facts that happened (stored forever)
- **State**: Derived by replaying events through `apply()` methods
- **Aggregate**: A cluster of domain objects treated as a single unit
- **Event Store**: Append-only log of all events (R2)
- **State Persistence**: Durable Objects use built-in transactional storage (zero-latency, no snapshots needed)

## Architecture

### Domain Event Pattern

Ceves separates domain logic from infrastructure concerns:

- **Domain Events**: Pure TypeScript classes containing only business data
- **StoredEvent**: Infrastructure envelope that wraps domain events with metadata
- **Event Handlers**: Receive domain event + metadata as separate parameters
- **Command Handlers**: Return domain event instances (not plain objects)

```typescript
// Domain event - pure business data
export class AccountOpenedEvent implements DomainEvent {
  readonly type = 'AccountOpened' as const;
  constructor(
    public readonly owner: string,
    public readonly initialDeposit: number
  ) {}
}

// Event handler - clean separation
@EventHandler({ eventType: 'AccountOpened', aggregateType: 'account' })
export class AccountOpenedHandler implements IEventHandler<AccountState, AccountOpenedEvent> {
  apply(
    state: AccountState | null,
    event: AccountOpenedEvent,
    metadata: EventMetadata
  ): Omit<AccountState, 'version' | 'orgId'> {
    return {
      id: metadata.aggregateId,
      owner: event.owner,
      balance: event.initialDeposit,
    };
  }
}

// Command handler - returns domain event
@Route({ method: 'POST', path: '/accounts/:id/open' })
export class OpenAccountHandler extends CreateCommandRoute<OpenAccountCommand, AccountState, AccountOpenedEvent> {
  async executeCommand(command: OpenAccountCommand): Promise<AccountOpenedEvent> {
    return new AccountOpenedEvent(command.owner, command.initialDeposit);
  }
}
```

### QueryHandler

Read-only queries via the `@QueryHandler` decorator:

```typescript
@QueryHandler
export class GetBalanceQuery implements IQueryHandler<BankAccountState, {}, BalanceResponse> {
  queryType = 'GetBalance';
  aggregateType = 'BankAccountAggregate';
  route = '/accounts/:id/balance';
  method = 'GET' as const;

  async execute(state: BankAccountState): Promise<BalanceResponse> {
    return { balance: state.balance, currency: 'USD' };
  }
}
```

## Documentation

- **Getting Started**: [GETTING_STARTED.md](./GETTING_STARTED.md)
- **Example**: [example/README.md](./example/README.md)

## License

MIT - see [LICENSE](./LICENSE)
