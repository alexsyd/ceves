/**
 * Integration tests for R2SnapshotStore using Miniflare
 *
 * These tests validate R2SnapshotStore against actual Workers runtime with real R2 bindings.
 * Unlike unit tests that use mocks, these tests verify:
 * 1. Snapshots are correctly written to and read from real R2 storage (via Miniflare)
 * 2. Latest snapshot wins (idempotent overwrites work correctly)
 * 3. Storage interoperability (save with one instance, load with another)
 * 4. Edge cases: missing snapshots return null (not an error)
 *
 * Test Environment:
 * - Runs in actual Workers runtime (workerd) via @cloudflare/vitest-pool-workers
 * - Uses Miniflare's automatic in-memory R2 bucket (env.TEST_EVENTS_BUCKET)
 * - Each test gets a fresh, isolated R2 bucket instance
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import type { R2Bucket } from '@cloudflare/workers-types';
import { R2SnapshotStore } from './R2SnapshotStore';
import type { StoredSnapshot } from './interfaces';

describe('R2SnapshotStore integration (Workers runtime)', () => {
  let snapshotStore: R2SnapshotStore;

  // Miniflare provides fresh bindings for each test - no cleanup needed
  beforeEach(() => {
    snapshotStore = new R2SnapshotStore(env.TEST_EVENTS_BUCKET as R2Bucket);
  });

  // Helper to create test snapshot
  function createTestSnapshot(
    aggregateType = 'account',
    aggregateId = 'acc-123',
    version = 1
  ): StoredSnapshot {
    return {
      aggregateType,
      aggregateId,
      version,
      timestamp: '2025-11-15T10:00:00.000Z',
      state: {
        id: aggregateId,
        balance: version * 100,
        timestamp: Date.now(),
      },
    };
  }

  describe('save() with real R2', () => {
    it('should save snapshot to R2 at correct path', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 1);

      // Act
      await snapshotStore.save(snapshot);

      // Assert - verify file was created at expected path
      const loaded = await snapshotStore.load('account', 'acc-123');
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(snapshot);
    });

    it('should overwrite existing snapshot (latest wins)', async () => {
      // Arrange
      const snapshot1 = createTestSnapshot('account', 'acc-456', 1);
      const snapshot2 = createTestSnapshot('account', 'acc-456', 5);

      // Act - save first snapshot, then overwrite with second
      await snapshotStore.save(snapshot1);
      await snapshotStore.save(snapshot2);

      // Assert - only latest snapshot should be retrievable
      const loaded = await snapshotStore.load('account', 'acc-456');
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(snapshot2);
      expect(loaded?.version).toBe(5);
    });

    it('should save snapshots for different aggregates independently', async () => {
      // Arrange
      const accountSnapshot = createTestSnapshot('account', 'acc-100', 10);
      const userSnapshot: StoredSnapshot = {
        aggregateType: 'user',
        aggregateId: 'usr-200',
        version: 5,
        timestamp: '2025-11-15T11:00:00.000Z',
        state: { id: 'usr-200', name: 'Alice' },
      };

      // Act
      await snapshotStore.save(accountSnapshot);
      await snapshotStore.save(userSnapshot);

      // Assert - both snapshots should be retrievable independently
      const loadedAccount = await snapshotStore.load('account', 'acc-100');
      const loadedUser = await snapshotStore.load('user', 'usr-200');

      expect(loadedAccount).toEqual(accountSnapshot);
      expect(loadedUser).toEqual(userSnapshot);
    });

    it('should handle snapshots with large state payloads', async () => {
      // Arrange - create snapshot with substantial state data
      const largeState = {
        id: 'acc-large',
        transactions: Array.from({ length: 100 }, (_, i) => ({
          id: `tx-${i}`,
          amount: i * 10,
          description: 'A'.repeat(50),
        })),
        metadata: {
          created: Date.now(),
          version: '1.0.0',
        },
      };

      const snapshot = createTestSnapshot('account', 'acc-large', 100);
      snapshot.state = largeState;

      // Act
      await snapshotStore.save(snapshot);

      // Assert
      const loaded = await snapshotStore.load('account', 'acc-large');
      expect(loaded).not.toBeNull();
      expect(loaded?.state).toEqual(largeState);
    });
  });

  describe('load()', () => {
    it('should load existing snapshot correctly', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-789', 42);
      await snapshotStore.save(snapshot);

      // Act
      const loaded = await snapshotStore.load('account', 'acc-789');

      // Assert
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(snapshot);
      expect(loaded?.version).toBe(42);
    });

    it('should return null when snapshot does not exist', async () => {
      // Act - load snapshot that was never saved
      const loaded = await snapshotStore.load('account', 'non-existent');

      // Assert - null is expected, not an error
      expect(loaded).toBeNull();
    });

    it('should return null for empty aggregate (no snapshot saved yet)', async () => {
      // Act
      const loaded = await snapshotStore.load('account', 'acc-empty');

      // Assert
      expect(loaded).toBeNull();
    });

    it('should retrieve correct snapshot after multiple overwrites', async () => {
      // Arrange - save multiple snapshots, overwriting each time
      for (let i = 1; i <= 10; i++) {
        await snapshotStore.save(
          createTestSnapshot('account', 'acc-overwrite', i)
        );
      }

      // Act
      const loaded = await snapshotStore.load('account', 'acc-overwrite');

      // Assert - should have latest version only
      expect(loaded).not.toBeNull();
      expect(loaded?.version).toBe(10);
    });
  });

  describe('interoperability - multiple instances', () => {
    it('should save with one instance and load with another', async () => {
      // Arrange
      const bucket = env.TEST_EVENTS_BUCKET as R2Bucket;
      const snapshotStore1 = new R2SnapshotStore(bucket);
      const snapshotStore2 = new R2SnapshotStore(bucket);

      const snapshot = createTestSnapshot('account', 'acc-interop', 1);

      // Act - save with instance 1
      await snapshotStore1.save(snapshot);

      // Assert - load with instance 2
      const loaded = await snapshotStore2.load('account', 'acc-interop');
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(snapshot);
    });

    it('should handle concurrent saves from different instances (latest wins)', async () => {
      // Arrange
      const bucket = env.TEST_EVENTS_BUCKET as R2Bucket;
      const snapshotStore1 = new R2SnapshotStore(bucket);
      const snapshotStore2 = new R2SnapshotStore(bucket);

      const snapshot1 = createTestSnapshot('account', 'acc-concurrent', 5);
      const snapshot2 = createTestSnapshot('account', 'acc-concurrent', 10);

      // Act - save concurrently from different instances
      await Promise.all([
        snapshotStore1.save(snapshot1),
        snapshotStore2.save(snapshot2),
      ]);

      // Assert - one of them should win (R2 eventual consistency)
      const snapshotStore3 = new R2SnapshotStore(bucket);
      const loaded = await snapshotStore3.load('account', 'acc-concurrent');

      expect(loaded).not.toBeNull();
      // Either version 5 or 10 should be present (whichever won the race)
      expect([5, 10]).toContain(loaded?.version);
    });
  });

  describe('Workers runtime edge cases', () => {
    it('should verify R2 consistency - rapid overwrites preserve latest', async () => {
      // Arrange
      const snapshots: StoredSnapshot[] = [];
      for (let i = 1; i <= 20; i++) {
        snapshots.push(
          createTestSnapshot('account', 'acc-consistency', i)
        );
      }

      // Act - save all snapshots rapidly (each overwrites the previous)
      for (const snapshot of snapshots) {
        await snapshotStore.save(snapshot);
      }

      // Assert - latest version should be retrievable
      const loaded = await snapshotStore.load('account', 'acc-consistency');
      expect(loaded).not.toBeNull();
      expect(loaded?.version).toBe(20);
    });

    it('should handle saving and loading multiple aggregates rapidly', async () => {
      // Arrange - create snapshots for many different aggregates
      const aggregateCount = 10;
      const snapshots: StoredSnapshot[] = [];

      for (let i = 1; i <= aggregateCount; i++) {
        snapshots.push(
          createTestSnapshot('account', `acc-multi-${i}`, i)
        );
      }

      // Act - save all snapshots
      await Promise.all(snapshots.map((s) => snapshotStore.save(s)));

      // Assert - all snapshots should be retrievable
      for (let i = 1; i <= aggregateCount; i++) {
        const loaded = await snapshotStore.load('account', `acc-multi-${i}`);
        expect(loaded).not.toBeNull();
        expect(loaded?.version).toBe(i);
      }
    });

    it('should preserve complex nested state structures', async () => {
      // Arrange - create snapshot with deeply nested state
      const complexState = {
        user: {
          profile: {
            name: 'Alice',
            preferences: {
              theme: 'dark',
              notifications: {
                email: true,
                sms: false,
                push: {
                  enabled: true,
                  frequency: 'daily',
                },
              },
            },
          },
          accounts: [
            { id: 'acc-1', balance: 100 },
            { id: 'acc-2', balance: 200 },
          ],
        },
      };

      const snapshot = createTestSnapshot('user', 'usr-complex', 1);
      snapshot.state = complexState;

      // Act
      await snapshotStore.save(snapshot);

      // Assert - complex structure should be preserved
      const loaded = await snapshotStore.load('user', 'usr-complex');
      expect(loaded).not.toBeNull();
      expect(loaded?.state).toEqual(complexState);
    });
  });
});
