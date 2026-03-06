# Getting Started with Ceves

This guide will help you build your first event-sourced application with Ceves in under 10 minutes.

## Prerequisites

- Node.js 20+
- npm or pnpm
- Basic TypeScript knowledge
- Cloudflare account (for deployment)

## Installation

```bash
npm install ceves
```

## Your First Aggregate: BankAccount

Let's build a simple bank account with deposit and withdraw functionality.

### 1. Define Your State

```typescript
// src/state.ts
import { BaseState } from 'ceves';

export interface BankAccountState extends BaseState {
  balance: number;
  isOpen: boolean;
}
```

### 2. Define Commands

```typescript
// src/commands.ts
import { BaseCommand } from 'ceves';
import { z } from 'zod';

export class OpenAccountCommand extends BaseCommand {
  static override schema = z.object({
    aggregateId: z.string(),
    initialDeposit: z.number().min(0),
  });
}

export class DepositCommand extends BaseCommand {
  static override schema = z.object({
    aggregateId: z.string(),
    amount: z.number().positive(),
  });
}

export class WithdrawCommand extends BaseCommand {
  static override schema = z.object({
    aggregateId: z.string(),
    amount: z.number().positive(),
  });
}
```

### 3. Define Events

```typescript
// src/events.ts
import { BaseEvent } from 'ceves';
import { z } from 'zod';
import { BankAccountState } from './state';

export class AccountOpenedEvent extends BaseEvent {
  static override eventType = 'AccountOpened';
  static override schema = z.object({
    aggregateId: z.string(),
    initialDeposit: z.number(),
  });

  override apply(state: BankAccountState | null): BankAccountState {
    return {
      orgId: this.aggregateId,
      aggregateId: this.aggregateId,
      version: 1,
      timestamp: new Date(),
      balance: this.initialDeposit || 0,
      isOpen: true,
    };
  }
}

export class MoneyDepositedEvent extends BaseEvent {
  static override eventType = 'MoneyDeposited';
  static override schema = z.object({
    aggregateId: z.string(),
    amount: z.number(),
  });

  override apply(state: BankAccountState | null): BankAccountState {
    if (!state) throw new Error('Account must be opened first');
    return {
      ...state,
      balance: state.balance + this.amount,
      version: state.version + 1,
      timestamp: new Date(),
    };
  }
}

export class MoneyWithdrawnEvent extends BaseEvent {
  static override eventType = 'MoneyWithdrawn';
  static override schema = z.object({
    aggregateId: z.string(),
    amount: z.number(),
  });

  override apply(state: BankAccountState | null): BankAccountState {
    if (!state) throw new Error('Account must be opened first');
    if (state.balance < this.amount) {
      throw new Error('Insufficient funds');
    }
    return {
      ...state,
      balance: state.balance - this.amount,
      version: state.version + 1,
      timestamp: new Date(),
    };
  }
}
```

### 4. Set Up for Cloudflare Workers

```typescript
// src/index.ts
import { Hono } from 'hono';
import { CevesApp, R2EventStore, D1SnapshotStore } from 'ceves';
import { OpenAccountCommand, DepositCommand, WithdrawCommand } from './commands';

type Env = {
  EVENTS: R2Bucket;
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

app.post('/account/:id/open', async (c) => {
  const ceves = new CevesApp({
    eventStore: new R2EventStore(c.env.EVENTS),
    snapshotStore: new D1SnapshotStore(c.env.DB),
  });

  const command = new OpenAccountCommand({
    aggregateId: c.req.param('id'),
    initialDeposit: await c.req.json().then(j => j.amount || 0),
  });

  const state = await ceves.execute(command);
  return c.json(state);
});

app.post('/account/:id/deposit', async (c) => {
  const ceves = new CevesApp({
    eventStore: new R2EventStore(c.env.EVENTS),
    snapshotStore: new D1SnapshotStore(c.env.DB),
  });

  const { amount } = await c.req.json();
  const command = new DepositCommand({
    aggregateId: c.req.param('id'),
    amount,
 });

  const state = await ceves.execute(command);
  return c.json(state);
});

export default app;
```

### 5. Configure Wrangler

```toml
# wrangler.toml
name = "bank-account-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[r2_buckets]]
binding = "EVENTS"
bucket_name = "bank-events"

[[d1_databases]]
binding = "DB"
database_name = "bank-snapshots"
database_id = "your-database-id"
```

### 6. Deploy

```bash
# Create D1 database
wrangler d1 create bank-snapshots

# Create R2 bucket
wrangler r2 bucket create bank-events

# Deploy
wrangler deploy
```

### 7. Test It!

```bash
# Open account
curl -X POST https://your-worker.workers.dev/account/acc-123/open \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000}'

# Deposit
curl -X POST https://your-worker.workers.dev/account/acc-123/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount": 500}'

# Withdraw
curl -X POST https://your-worker.workers.dev/account/acc-123/withdraw \
  -H "Content-Type: application/json" \
  -d '{"amount": 200}'
```

## Local Development

```bash
# Run tests
npm test

# Watch mode
wrangler dev
```

## Next Steps

- **Testing**: Check `/example/src` for comprehensive test examples
- **Durable Objects**: See `/example` for zero-latency state persistence with DO Storage API
- **Advanced**: Explore multi-tenancy, custom storage backends
- **API Reference**: Run `npm run docs` to generate full API documentation

## Core Concepts

### Event Sourcing
Instead of storing current state, we store all events that led to that state. This gives us:
- Complete audit trail
- Time travel (replay to any point)
- Event-driven architecture

### Commands vs Events
- **Commands**: Intent to change state (can fail validation)
- **Events**: Things that happened (immutable facts)

### State Restoration
Ceves automatically restores state before your handlers execute:

**For Durable Objects (recommended):**
1. Load state from DO's built-in transactional storage (zero-latency)
2. If empty, replay all events from R2
3. Pass current state to your handler

## Need Help?

- **Examples**: `/example` folder
- **Issues**: [GitHub Issues](https://github.com/alexsyd/ceves/issues)
- **Documentation**: Run `npm run docs` for full API reference
