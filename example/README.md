# Ceves Example - BankAccount

A complete working example demonstrating the Ceves event sourcing library for Cloudflare Workers.

This example implements a simple bank account domain with commands (Open, Deposit, Withdraw) and events (AccountOpened, MoneyDeposited, MoneyWithdrawn).

## Prerequisites

- Node.js 18+ and pnpm installed
- Cloudflare account (for deployment, not required for local development)
- Wrangler CLI (installed via package.json)

## Quick Start

### 1. Install Dependencies

From the repository root:

```bash
pnpm install
```

### 2. Start Local Development Server

```bash
cd example
pnpm dev
```

This starts Wrangler's local dev server with in-memory R2 and D1 bindings.

### 3. Test the API

**Open a new account:**

```bash
curl -X POST http://localhost:8787/accounts/acc-123/open \
  -H "Content-Type: application/json" \
  -d '{
    "aggregateType": "account",
    "aggregateId": "acc-123",
    "owner": "Alice",
    "initialDeposit": 100
  }'
```

**Deposit money:**

```bash
curl -X POST http://localhost:8787/accounts/acc-123/deposit \
  -H "Content-Type: application/json" \
  -d '{
    "aggregateType": "account",
    "aggregateId": "acc-123",
    "amount": 50
  }'
```

**Withdraw money:**

```bash
curl -X POST http://localhost:8787/accounts/acc-123/withdraw \
  -H "Content-Type: application/json" \
  -d '{
    "aggregateType": "account",
    "aggregateId": "acc-123",
    "amount": 25
  }'
```

## Project Structure

```
example/
├── src/
│   ├── index.ts              # Worker entry point
│   ├── types.ts              # Domain types (commands, events, state)
│   ├── commands/             # Command handlers
│   │   ├── OpenAccountHandler.ts
│   │   ├── DepositHandler.ts
│   │   └── WithdrawHandler.ts
│   └── events/               # Event handlers
│       ├── AccountOpenedHandler.ts
│       ├── MoneyDepositedHandler.ts
│       └── MoneyWithdrawnHandler.ts
├── package.json
├── tsconfig.json
├── wrangler.toml             # Cloudflare configuration
└── README.md
```

## API Endpoints

All endpoints expect JSON payloads with `aggregateType` and `aggregateId` fields.

### POST /accounts/:id/open

Open a new bank account.

**Request:**
```json
{
  "aggregateType": "account",
  "aggregateId": "acc-123",
  "owner": "Alice",
  "initialDeposit": 100
}
```

**Response (Success):**
```json
{
  "success": true,
  "aggregateId": "acc-123",
  "version": 1
}
```

**Response (Error - Account Exists):**
```json
{
  "success": false,
  "error": "Domain error",
  "message": "Account already exists"
}
```

### POST /accounts/:id/deposit

Deposit money into an existing account.

**Request:**
```json
{
  "aggregateType": "account",
  "aggregateId": "acc-123",
  "amount": 50
}
```

**Response:**
```json
{
  "success": true,
  "aggregateId": "acc-123",
  "version": 2
}
```

### POST /accounts/:id/withdraw

Withdraw money from an existing account.

**Request:**
```json
{
  "aggregateType": "account",
  "aggregateId": "acc-123",
  "amount": 25
}
```

**Response (Success):**
```json
{
  "success": true,
  "aggregateId": "acc-123",
  "version": 3
}
```

**Response (Error - Insufficient Funds):**
```json
{
  "success": false,
  "error": "Domain error",
  "message": "Insufficient funds"
}
```

## Testing

Run the test suite:

```bash
pnpm test
```

Tests demonstrate:
- Unit testing command handlers (execute methods)
- Unit testing event handlers (apply methods)
- Testing with in-memory stores (no Cloudflare infrastructure required)

## Deployment

### 1. Create R2 Bucket

```bash
wrangler r2 bucket create ceves-example-events
```

### 2. (Optional) Create D1 Database for Snapshots

```bash
wrangler d1 create ceves-example-snapshots
```

Copy the `database_id` from the output and update `wrangler.toml`.

### 3. Deploy

```bash
pnpm deploy
```

Your event-sourced API is now live on Cloudflare Workers!

## How It Works

This example demonstrates the core Ceves patterns:

1. **Domain Types** (`types.ts`) - Define commands, events, and state using Zod schemas
2. **Command Handlers** (`commands/`) - Implement business logic using `@CommandHandler` decorator
3. **Event Handlers** (`events/`) - Implement state transformations using `@EventHandler` decorator
4. **Automatic Wiring** - Ceves automatically:
   - Discovers decorated handlers
   - Registers HTTP routes
   - Restores state before command execution
   - Persists events after command execution
   - Applies events to rebuild state

## Event Sourcing Flow

1. **Command arrives** - HTTP POST to /accounts/:id/open
2. **State restoration** - Ceves loads snapshot + events from R2/D1
3. **Command execution** - Your handler validates and returns event
4. **Event persistence** - Ceves saves event to R2 with incremented version
5. **Response** - Success with new version number

On subsequent commands:
- State is rebuilt from all previous events
- New command executes with restored state
- New event is appended to event log
- State evolves over time

## API Testing with Postman & Newman

This example includes a Postman collection and automated Newman tests for complete API validation.

### OpenAPI Schema

The API exposes an OpenAPI 3.1 schema at:

```
GET http://localhost:8787/openapi.json
```

This schema is automatically generated from the command handlers using Chanfana.

### Using the Postman Collection

1. **Import the collection into Postman:**
   - Open Postman desktop app
   - Import `postman/ceves-bankaccount.postman_collection.json`
   - Import `postman/ceves-bankaccount.postman_environment.json`

2. **Start the local server:**
   ```bash
   npm run dev
   ```

3. **Select the environment:**
   - In Postman, select "Ceves BankAccount - Local" from the environment dropdown

4. **Run requests manually:**
   - Execute requests in order: Open Account → Deposit → Withdraw
   - Account ID is auto-generated using timestamps

### Running Automated Tests with Newman

**Run the complete test suite:**

```bash
# Start server and run tests (automated)
npm run newman:ci
```

This will:
1. Start Wrangler dev server in background
2. Run complete Newman test suite (5 tests)
3. Generate HTML report in `newman-results/report.html`
4. Stop the dev server automatically

**View test results:**

```bash
open newman-results/report.html   # macOS
xdg-open newman-results/report.html  # Linux
```

### Test Coverage

The Newman test suite validates:

**Happy Path:**
- ✅ Account creation with initial deposit ($100)
- ✅ Money deposit increasing balance to $150
- ✅ Money withdrawal decreasing balance to $125
- ✅ Version increments with each command (1 → 2 → 3)

**Error Cases:**
- ✅ Duplicate account creation returns 400
- ✅ Insufficient funds withdrawal returns 400

### Regenerating the Postman Collection

If you modify the API (add/change endpoints):

```bash
# Extract latest OpenAPI schema + regenerate collection
npm run postman:all
```

This extracts the schema from the running Worker and converts it to Postman format.

### GitHub Actions Integration

The example includes `.github/workflows/ci.yml` for automated testing:

```yaml
stages:
  - test      # Unit tests
  - api-test  # Newman API tests
```

Push to GitHub to run tests automatically on every commit.

---

## Troubleshooting

**Issue:** `wrangler dev` fails with binding errors

**Solution:** Wrangler automatically provides in-memory R2 and D1 bindings for local development. No manual setup required.

---

**Issue:** "Account not found" when depositing/withdrawing

**Solution:** Make sure you've opened the account first with POST /accounts/:id/open

---

**Issue:** Newman tests fail with connection errors

**Solution:** Ensure Wrangler dev server is running on port 8787. The `newman:ci` script handles this automatically.

---

**Issue:** TypeScript errors about missing types

**Solution:** Run `npm install` from repository root to install all dependencies

---

## Next Steps

- Explore the source code to see how handlers are implemented
- Modify domain logic (add new commands/events)
- Add snapshot creation after N events
- Import Postman collection to explore the API interactively
- Deploy to production Cloudflare Workers

For more information, see the main [Ceves README](../README.md).
