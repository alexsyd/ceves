/**
 * BankAccountAggregate - Durable Object for bank account aggregate
 *
 * Command handlers are methods decorated with @CommandHandler.
 * Infrastructure (state restoration, event persistence) is automatic.
 */

import { AggregateObject, CommandHandler, BusinessRuleViolationError } from 'ceves';
import { AccountState } from '../types';
import type {
  OpenAccountCommand,
  DepositCommand,
  WithdrawCommand,
} from '../types';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { z } from 'zod';
import { AccountOpenedEvent } from '../events/AccountOpenedEvent';
import { MoneyDepositedEvent } from '../events/MoneyDepositedEvent';
import { MoneyWithdrawnEvent } from '../events/MoneyWithdrawnEvent';

// Request/Response Schemas for Chanfana/OpenAPI

const OpenAccountParams = z.object({
  id: z.string().describe('Account ID'),
});

const OpenAccountBody = z.object({
  owner: z.string().min(1).describe('Account owner name'),
  initialDeposit: z.number().min(0).describe('Initial deposit amount'),
});

const OpenAccountResponse = z.object({
  success: z.boolean(),
  aggregateId: z.string(),
  version: z.number(),
});

const DepositParams = z.object({
  id: z.string().describe('Account ID'),
});

const DepositBody = z.object({
  amount: z.number().positive().describe('Deposit amount'),
});

const DepositResponse = z.object({
  success: z.boolean(),
  aggregateId: z.string(),
  version: z.number(),
});

const WithdrawParams = z.object({
  id: z.string().describe('Account ID'),
});

const WithdrawBody = z.object({
  amount: z.number().positive().describe('Withdrawal amount'),
});

const WithdrawResponse = z.object({
  success: z.boolean(),
  aggregateId: z.string(),
  version: z.number(),
});

/**
 * Bank Account Aggregate - DO-first architecture
 *
 * All command handling is done via decorated methods.
 * State restoration and event persistence is automatic.
 */
export class BankAccountAggregate extends AggregateObject<AccountState> {
  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env, AccountState);
  }

  /**
   * Open a new bank account (CREATE command)
   *
   * Domain Rules:
   * - Account must not already exist (enforced by createCommand: true)
   * - Owner name must be provided
   * - Initial deposit must be non-negative
   *
   * @param command - Validated OpenAccount command
   * @returns AccountOpened domain event
   */
  @CommandHandler({
    commandType: 'OpenAccount',
    createCommand: true,  // Requires state === null
    route: '/accounts/:id/open',
    method: 'POST',
    params: OpenAccountParams,
    body: OpenAccountBody,
    responses: {
      200: OpenAccountResponse,
      400: z.object({ error: z.string(), message: z.string() }),
      409: z.object({ error: z.string(), message: z.string() }),
    },
    summary: 'Open a new bank account',
    description: 'Creates a new bank account with an initial deposit',
    tags: ['Bank Account'],
  })
  async openAccount(command: OpenAccountCommand): Promise<AccountOpenedEvent> {
    // Just business logic - infrastructure handled by base class
    // No need to check if account exists - createCommand: true enforces it
    return new AccountOpenedEvent(command.owner, command.initialDeposit);
  }

  /**
   * Deposit money into existing account (UPDATE command)
   *
   * Domain Rules:
   * - Account must exist (enforced by createCommand: false)
   * - Deposit amount must be positive (validated by schema)
   *
   * @param command - Validated Deposit command
   * @returns MoneyDeposited domain event
   */
  @CommandHandler({
    commandType: 'Deposit',
    createCommand: false,  // Requires state !== null
    route: '/accounts/:id/deposit',
    method: 'POST',
    params: DepositParams,
    body: DepositBody,
    responses: {
      200: DepositResponse,
      400: z.object({ error: z.string(), message: z.string() }),
      404: z.object({ error: z.string(), message: z.string() }),
    },
    summary: 'Deposit money into account',
    description: 'Adds money to an existing bank account',
    tags: ['Bank Account'],
  })
  async deposit(command: DepositCommand): Promise<MoneyDepositedEvent> {
    // Just business logic - no existence check needed
    // createCommand: false ensures state is non-null
    return new MoneyDepositedEvent(command.amount);
  }

  /**
   * Withdraw money from existing account (UPDATE command)
   *
   * Domain Rules:
   * - Account must exist (enforced by createCommand: false)
   * - Withdrawal amount must be positive (validated by schema)
   * - Account must have sufficient balance (validated here)
   *
   * @param command - Validated Withdraw command
   * @returns MoneyWithdrawn domain event
   * @throws BusinessRuleViolationError if insufficient funds
   */
  @CommandHandler({
    commandType: 'Withdraw',
    createCommand: false,  // Requires state !== null
    route: '/accounts/:id/withdraw',
    method: 'POST',
    params: WithdrawParams,
    body: WithdrawBody,
    responses: {
      200: WithdrawResponse,
      400: z.object({ error: z.string(), message: z.string() }),
      404: z.object({ error: z.string(), message: z.string() }),
    },
    summary: 'Withdraw money from account',
    description: 'Withdraws money from an existing bank account',
    tags: ['Bank Account'],
  })
  async withdraw(command: WithdrawCommand): Promise<MoneyWithdrawnEvent> {
    // Can access this.state directly! (createCommand: false guarantees non-null)
    if (this.state!.balance < command.amount) {
      throw new BusinessRuleViolationError(
        `Insufficient funds. Current balance: ${this.state!.balance}, requested: ${command.amount}`
      );
    }

    return new MoneyWithdrawnEvent(command.amount);
  }
}
