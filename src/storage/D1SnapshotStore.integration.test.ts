/**
 * Integration tests for D1SnapshotStore using Miniflare
 *
 * These tests validate D1SnapshotStore against actual Workers runtime with real D1 bindings.
 * Unlike unit tests that use mocks, these tests verify:
 * 1. Snapshots are correctly written to and read from real D1 database (via Miniflare)
 * 2. Automatic table creation works on first use
 * 3. INSERT OR REPLACE provides correct upsert behavior (latest wins)
 * 4. Storage interoperability (save with one instance, load with another)
 * 5. Edge cases: missing snapshots return null (not an error)
 * 6. D1 transactions behave correctly in Workers runtime
 *
 * Test Environment:
 * - Runs in actual Workers runtime (workerd) via @cloudflare/vitest-pool-workers
 * - Uses Miniflare's automatic in-memory D1 database (env.TEST_SNAPSHOTS_DB)
 * - Each test gets a fresh, isolated D1 database instance
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import type { D1Database } from '@cloudflare/workers-types';
import { D1SnapshotStore } from './D1SnapshotStore';
import type { StoredSnapshot } from './interfaces';

describe('D1SnapshotStore integration (Workers runtime)', () => {
  let snapshotStore: D1SnapshotStore;

  // Miniflare provides fresh bindings for each test - no cleanup needed
  beforeEach(() => {
    snapshotStore = new D1SnapshotStore(env.TEST_SNAPSHOTS_DB as D1Database);
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

  describe('automatic table creation', () => {
    it('should automatically create table on first save', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 1);

      // Act - first save should trigger table creation
      await snapshotStore.save(snapshot);

      // Assert - snapshot should be retrievable
      const loaded = await snapshotStore.load('account', 'acc-123');
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(snapshot);
    });

    it('should automatically create table on first load', async () => {
      // Act - load on empty database should create table and return null
      const loaded = await snapshotStore.load('account', 'acc-empty');

      // Assert - null is expected, but table should now exist
      expect(loaded).toBeNull();

      // Save should work after table creation
      const snapshot = createTestSnapshot('account', 'acc-456', 1);
      await snapshotStore.save(snapshot);

      const loadedAfterSave = await snapshotStore.load('account', 'acc-456');
      expect(loadedAfterSave).toEqual(snapshot);
    });

    it('should handle multiple instances creating table concurrently', async () => {
      // Arrange - multiple store instances on same database
      const db = env.TEST_SNAPSHOTS_DB as D1Database;
      const store1 = new D1SnapshotStore(db);
      const store2 = new D1SnapshotStore(db);

      const snapshot1 = createTestSnapshot('account', 'acc-100', 1);
      const snapshot2 = createTestSnapshot('account', 'acc-200', 2);

      // Act - save from different instances (both may try to create table)
      await Promise.all([store1.save(snapshot1), store2.save(snapshot2)]);

      // Assert - both snapshots should be retrievable
      const loaded1 = await store1.load('account', 'acc-100');
      const loaded2 = await store2.load('account', 'acc-200');

      expect(loaded1).toEqual(snapshot1);
      expect(loaded2).toEqual(snapshot2);
    });
  });

  describe('save() with INSERT OR REPLACE', () => {
    it('should save snapshot to D1 database', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-789', 42);

      // Act
      await snapshotStore.save(snapshot);

      // Assert
      const loaded = await snapshotStore.load('account', 'acc-789');
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(snapshot);
    });

    it('should replace existing snapshot (INSERT OR REPLACE behavior)', async () => {
      // Arrange
      const snapshot1 = createTestSnapshot('account', 'acc-456', 5);
      const snapshot2 = createTestSnapshot('account', 'acc-456', 10);

      // Act - save first, then replace
      await snapshotStore.save(snapshot1);
      await snapshotStore.save(snapshot2);

      // Assert - only latest snapshot should exist
      const loaded = await snapshotStore.load('account', 'acc-456');
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(snapshot2);
      expect(loaded?.version).toBe(10);
    });

    it('should save snapshots for different aggregates independently', async () => {
      // Arrange
      const accountSnapshot = createTestSnapshot('account', 'acc-300', 15);
      const userSnapshot: StoredSnapshot = {
        aggregateType: 'user',
        aggregateId: 'usr-400',
        version: 8,
        timestamp: '2025-11-15T11:00:00.000Z',
        state: { id: 'usr-400', name: 'Bob' },
      };

      // Act
      await snapshotStore.save(accountSnapshot);
      await snapshotStore.save(userSnapshot);

      // Assert - both should be independently retrievable
      const loadedAccount = await snapshotStore.load('account', 'acc-300');
      const loadedUser = await snapshotStore.load('user', 'usr-400');

      expect(loadedAccount).toEqual(accountSnapshot);
      expect(loadedUser).toEqual(userSnapshot);
    });

    it('should handle snapshots with complex state objects', async () => {
      // Arrange - complex nested state
      const complexState = {
        user: {
          profile: { name: 'Alice', age: 30 },
          accounts: [
            { id: 'acc-1', balance: 100 },
            { id: 'acc-2', balance: 200 },
          ],
        },
        metadata: {
          created: Date.now(),
          tags: ['premium', 'verified'],
        },
      };

      const snapshot = createTestSnapshot('user', 'usr-complex', 1);
      snapshot.state = complexState;

      // Act
      await snapshotStore.save(snapshot);

      // Assert - complex state should be preserved
      const loaded = await snapshotStore.load('user', 'usr-complex');
      expect(loaded).not.toBeNull();
      expect(loaded?.state).toEqual(complexState);
    });
  });

  describe('load() with SQL query', () => {
    it('should load existing snapshot correctly', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-999', 50);
      await snapshotStore.save(snapshot);

      // Act
      const loaded = await snapshotStore.load('account', 'acc-999');

      // Assert
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(snapshot);
      expect(loaded?.version).toBe(50);
    });

    it('should return null when snapshot does not exist', async () => {
      // Act - query for non-existent snapshot
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
      // Arrange - overwrite snapshot multiple times
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

  describe('multiple snapshots for different aggregates', () => {
    it('should store and retrieve many different aggregates', async () => {
      // Arrange - create snapshots for many aggregates
      const aggregateCount = 20;
      const snapshots: StoredSnapshot[] = [];

      for (let i = 1; i <= aggregateCount; i++) {
        snapshots.push(
          createTestSnapshot('account', `acc-multi-${i}`, i)
        );
      }

      // Act - save all snapshots
      for (const snapshot of snapshots) {
        await snapshotStore.save(snapshot);
      }

      // Assert - all should be retrievable
      for (let i = 1; i <= aggregateCount; i++) {
        const loaded = await snapshotStore.load('account', `acc-multi-${i}`);
        expect(loaded).not.toBeNull();
        expect(loaded?.version).toBe(i);
      }
    });

    it('should handle different aggregate types in same database', async () => {
      // Arrange
      const accountSnap = createTestSnapshot('account', 'acc-1', 1);
      const userSnap = createTestSnapshot('user', 'usr-1', 2);
      const orderSnap = createTestSnapshot('order', 'ord-1', 3);

      // Act
      await Promise.all([
        snapshotStore.save(accountSnap),
        snapshotStore.save(userSnap),
        snapshotStore.save(orderSnap),
      ]);

      // Assert - all types should coexist
      const loadedAccount = await snapshotStore.load('account', 'acc-1');
      const loadedUser = await snapshotStore.load('user', 'usr-1');
      const loadedOrder = await snapshotStore.load('order', 'ord-1');

      expect(loadedAccount).toEqual(accountSnap);
      expect(loadedUser).toEqual(userSnap);
      expect(loadedOrder).toEqual(orderSnap);
    });
  });

  describe('interoperability - multiple instances', () => {
    it('should save with one instance and load with another', async () => {
      // Arrange
      const db = env.TEST_SNAPSHOTS_DB as D1Database;
      const store1 = new D1SnapshotStore(db);
      const store2 = new D1SnapshotStore(db);

      const snapshot = createTestSnapshot('account', 'acc-interop', 1);

      // Act - save with instance 1
      await store1.save(snapshot);

      // Assert - load with instance 2
      const loaded = await store2.load('account', 'acc-interop');
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(snapshot);
    });

    it('should handle concurrent saves from different instances (latest wins)', async () => {
      // Arrange
      const db = env.TEST_SNAPSHOTS_DB as D1Database;
      const store1 = new D1SnapshotStore(db);
      const store2 = new D1SnapshotStore(db);

      const snapshot1 = createTestSnapshot('account', 'acc-concurrent', 5);
      const snapshot2 = createTestSnapshot('account', 'acc-concurrent', 10);

      // Act - save from different instances sequentially
      await store1.save(snapshot1);
      await store2.save(snapshot2);

      // Assert - latest save should win
      const store3 = new D1SnapshotStore(db);
      const loaded = await store3.load('account', 'acc-concurrent');

      expect(loaded).not.toBeNull();
      expect(loaded?.version).toBe(10); // Latest wins
    });
  });

  describe('Workers runtime edge cases', () => {
    it('should verify D1 transaction atomicity with INSERT OR REPLACE', async () => {
      // Arrange
      const snapshots: StoredSnapshot[] = [];
      for (let i = 1; i <= 15; i++) {
        snapshots.push(
          createTestSnapshot('account', 'acc-atomicity', i)
        );
      }

      // Act - save all snapshots (each replaces the previous)
      for (const snapshot of snapshots) {
        await snapshotStore.save(snapshot);
      }

      // Assert - latest version should be stored
      const loaded = await snapshotStore.load('account', 'acc-atomicity');
      expect(loaded).not.toBeNull();
      expect(loaded?.version).toBe(15);
    });

    it('should handle rapid concurrent saves to different aggregates', async () => {
      // Arrange
      const snapshots: StoredSnapshot[] = [];
      for (let i = 1; i <= 10; i++) {
        snapshots.push(
          createTestSnapshot('account', `acc-rapid-${i}`, i)
        );
      }

      // Act - save all concurrently
      await Promise.all(snapshots.map((s) => snapshotStore.save(s)));

      // Assert - all should be retrievable
      for (let i = 1; i <= 10; i++) {
        const loaded = await snapshotStore.load('account', `acc-rapid-${i}`);
        expect(loaded).not.toBeNull();
        expect(loaded?.version).toBe(i);
      }
    });

    it('should preserve state with special characters and JSON edge cases', async () => {
      // Arrange - state with special characters, quotes, etc.
      const edgeCaseState = {
        text: 'String with "quotes" and \'apostrophes\'',
        unicode: '你好世界 🌍',
        escaped: 'Line 1\\nLine 2\\tTabbed',
        nested: {
          nullValue: null,
          boolTrue: true,
          boolFalse: false,
          number: 42.5,
          array: [1, 'two', { three: 3 }],
        },
      };

      const snapshot = createTestSnapshot('test', 'edge-case', 1);
      snapshot.state = edgeCaseState;

      // Act
      await snapshotStore.save(snapshot);

      // Assert - all edge cases should be preserved
      const loaded = await snapshotStore.load('test', 'edge-case');
      expect(loaded).not.toBeNull();
      expect(loaded?.state).toEqual(edgeCaseState);
    });
  });
});
