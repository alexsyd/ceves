/**
 * BankAccount Domain Types
 *
 * This file defines the domain model for a simple bank account:
 * - Commands: OpenAccount, Deposit, Withdraw
 * - Events: AccountOpened, MoneyDeposited, MoneyWithdrawn
 * - State: AccountState
 */

import { z } from 'zod';
import { defineCommand, BaseState } from 'ceves';

/**
 * AccountState - Current state of a bank account (ADR-009)
 *
 * Extends BaseState which provides:
 * - id: Aggregate identifier (set by event handlers)
 * - orgId: Organization/tenant ID (set by event handlers)
 * - version: Event version (auto-set by framework)
 * - timestamp: Last update time (auto-set by framework)
 */
export class AccountState extends BaseState {
  owner: string = '';
  balance: number = 0;
}

/**
 * Commands - Requests to modify account state
 */

export const OpenAccountCommandSchema = defineCommand('OpenAccount', {
  owner: z.string().min(1, 'Owner name is required'),
  initialDeposit: z.number().min(0, 'Initial deposit must be non-negative'),
});

export const DepositCommandSchema = defineCommand('Deposit', {
  amount: z.number().positive('Deposit amount must be positive'),
});

export const WithdrawCommandSchema = defineCommand('Withdraw', {
  amount: z.number().positive('Withdrawal amount must be positive'),
});

export type OpenAccountCommand = z.infer<typeof OpenAccountCommandSchema>;
export type DepositCommand = z.infer<typeof DepositCommandSchema>;
export type WithdrawCommand = z.infer<typeof WithdrawCommandSchema>;

/**
 * Events - Facts about what happened to an account
 */

export const AccountOpenedEventSchema = z.object({
  aggregateType: z.literal('account'),
  aggregateId: z.string(),
  version: z.number(),
  timestamp: z.string(),
  type: z.literal('AccountOpened'),
  data: z.object({
    orgId: z.string(),  // Tenant/org that owns this account
    owner: z.string(),
    initialDeposit: z.number(),
  }),
});

export const MoneyDepositedEventSchema = z.object({
  aggregateType: z.literal('account'),
  aggregateId: z.string(),
  version: z.number(),
  timestamp: z.string(),
  type: z.literal('MoneyDeposited'),
  data: z.object({
    orgId: z.string(),  // For consistency, all events include orgId
    amount: z.number(),
  }),
});

export const MoneyWithdrawnEventSchema = z.object({
  aggregateType: z.literal('account'),
  aggregateId: z.string(),
  version: z.number(),
  timestamp: z.string(),
  type: z.literal('MoneyWithdrawn'),
  data: z.object({
    orgId: z.string(),  // For consistency, all events include orgId
    amount: z.number(),
  }),
});

export type AccountOpenedEvent = z.infer<typeof AccountOpenedEventSchema>;
export type MoneyDepositedEvent = z.infer<typeof MoneyDepositedEventSchema>;
export type MoneyWithdrawnEvent = z.infer<typeof MoneyWithdrawnEventSchema>;
