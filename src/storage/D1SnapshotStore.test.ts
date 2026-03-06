/**
 * Unit tests for D1SnapshotStore
 *
 * These tests verify that:
 * 1. D1SnapshotStore correctly implements the ISnapshotStore interface
 * 2. Snapshots are saved to D1 with correct SQL schema
 * 3. Snapshots are loaded correctly or return null for missing snapshots
 * 4. Latest snapshot wins (idempotent overwrites via INSERT OR REPLACE)
 * 5. Errors are properly wrapped in domain-specific error classes
 * 6. Edge cases are handled correctly (null state, complex structures)
 * 7. Table initialization is idempotent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { D1SnapshotStore } from './D1SnapshotStore';
import type { StoredSnapshot } from './interfaces';
import {
  SnapshotStoreError,
  SnapshotWriteError,
  SnapshotCorruptedError,
} from './errors';

describe('D1SnapshotStore', () => {
  // Helper to create mock D1Database
  function createMockD1Database(): D1Database {
    const mockRun = vi.fn().mockResolvedValue(undefined);
    const mockFirst = vi.fn().mockResolvedValue(null);

    return {
      prepare: vi.fn(() => ({
        // Support both prepare().run() and prepare().bind().run() patterns
        run: mockRun,
        first: mockFirst,
        bind: vi.fn(() => ({
          run: mockRun,
          first: mockFirst,
        })),
      })),
      dump: vi.fn(),
      batch: vi.fn(),
      exec: vi.fn(),
    } as unknown as D1Database;
  }

  // Helper to create test snapshot
  function createTestSnapshot(
    aggregateType = 'account',
    aggregateId = 'acc-123',
    version = 42,
    state: unknown = { balance: 1500 }
  ): StoredSnapshot {
    return {
      aggregateType,
      aggregateId,
      version,
      timestamp: '2025-11-14T10:30:00.000Z',
      state,
    };
  }

  // Helper to create mock prepared statement (supports both prepare().run() and prepare().bind().run())
  function createMockPreparedStatement(
    runResult: unknown = undefined,
    firstResult: unknown = null
  ) {
    const mockRun = vi.fn().mockResolvedValue(runResult);
    const mockFirst = vi.fn().mockResolvedValue(firstResult);
    return {
      run: mockRun,
      first: mockFirst,
      bind: vi.fn().mockReturnValue({
        run: mockRun,
        first: mockFirst,
      }),
    };
  }

  describe('constructor', () => {
    it('should create instance with D1Database', () => {
      // Arrange
      const db = createMockD1Database();

      // Act
      const store = new D1SnapshotStore(db);

      // Assert
      expect(store).toBeDefined();
      expect(store).toBeInstanceOf(D1SnapshotStore);
    });
  });

  describe('save()', () => {
    let db: D1Database;
    let store: D1SnapshotStore;

    beforeEach(() => {
      db = createMockD1Database();
      store = new D1SnapshotStore(db);
    });

    it('should create table on first save', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 42);
      vi.mocked(db.prepare).mockReturnValue(createMockPreparedStatement() as unknown as D1PreparedStatement);

      // Act
      await store.save(snapshot);

      // Assert
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS snapshots')
      );
    });

    it('should save snapshot to D1 with correct SQL', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 42);
      const mockStmt = createMockPreparedStatement();
      vi.mocked(db.prepare).mockReturnValue(mockStmt as unknown as D1PreparedStatement);

      // Act
      await store.save(snapshot);

      // Assert - Should have two prepare calls: CREATE TABLE and INSERT
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO snapshots')
      );
      expect(mockStmt.bind).toHaveBeenCalledWith(
        'account',
        'acc-123',
        42,
        '2025-11-14T10:30:00.000Z',
        JSON.stringify({ balance: 1500 })
      );
    });

    it('should serialize snapshot state to JSON correctly', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 5, {
        id: 'acc-123',
        balance: 1500,
        currency: 'USD',
        transactions: 42,
      });
      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: vi.fn() });
      vi.mocked(db.prepare).mockReturnValue({
        run: vi.fn().mockResolvedValue(undefined),
        first: vi.fn().mockResolvedValue(null),
        bind: mockBind
      } as unknown as D1PreparedStatement);

      // Act
      await store.save(snapshot);

      // Assert
      const expectedJson = JSON.stringify(snapshot.state);
      expect(mockBind).toHaveBeenCalledWith(
        'account',
        'acc-123',
        5,
        snapshot.timestamp,
        expectedJson
      );
    });

    it('should handle different aggregate types', async () => {
      // Arrange
      const accountSnapshot = createTestSnapshot('account', 'acc-123', 1);
      const userSnapshot = createTestSnapshot('user', 'user-456', 1);
      const orderSnapshot = createTestSnapshot('order', 'order-789', 1);

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: vi.fn() });
      vi.mocked(db.prepare).mockReturnValue({
        run: vi.fn().mockResolvedValue(undefined),
        first: vi.fn().mockResolvedValue(null),
        bind: mockBind
      } as unknown as D1PreparedStatement);

      // Act & Assert
      await store.save(accountSnapshot);
      expect(mockBind).toHaveBeenCalledWith(
        'account',
        'acc-123',
        1,
        expect.any(String),
        expect.any(String)
      );

      await store.save(userSnapshot);
      expect(mockBind).toHaveBeenCalledWith(
        'user',
        'user-456',
        1,
        expect.any(String),
        expect.any(String)
      );

      await store.save(orderSnapshot);
      expect(mockBind).toHaveBeenCalledWith(
        'order',
        'order-789',
        1,
        expect.any(String),
        expect.any(String)
      );
    });

    it('should upsert (overwrite existing snapshot)', async () => {
      // Arrange
      const snapshot1 = createTestSnapshot('account', 'acc-123', 10, {
        balance: 1000,
      });
      const snapshot2 = createTestSnapshot('account', 'acc-123', 20, {
        balance: 2000,
      });

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: vi.fn() });
      vi.mocked(db.prepare).mockReturnValue({
        run: vi.fn().mockResolvedValue(undefined),
        first: vi.fn().mockResolvedValue(null),
        bind: mockBind
      } as unknown as D1PreparedStatement);

      // Act - Save twice to same aggregate
      await store.save(snapshot1);
      await store.save(snapshot2);

      // Assert - Both use INSERT OR REPLACE (upsert behavior)
      const insertCalls = vi
        .mocked(db.prepare)
        .mock.calls.filter((call) =>
          call[0].includes('INSERT OR REPLACE')
        );
      expect(insertCalls).toHaveLength(2);
    });

    it('should throw SnapshotWriteError when D1 fails', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 42);
      const d1Error = new Error('D1 database unavailable');
      // First call (CREATE TABLE) succeeds, second call (INSERT) fails
      const mockRun = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(d1Error);
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: vi.fn().mockResolvedValue(null),
        bind: vi.fn().mockReturnValue({ run: mockRun, first: vi.fn() }),
      } as unknown as D1PreparedStatement);

      // Act & Assert
      await expect(store.save(snapshot)).rejects.toThrow(SnapshotWriteError);

      // Reset mock for second test (table already initialized, so only INSERT will run)
      mockRun.mockClear();
      mockRun.mockRejectedValue(d1Error);
      await expect(store.save(snapshot)).rejects.toThrow(
        'Failed to save snapshot for account/acc-123 v42'
      );

      // Reset mock for third test (table already initialized, so only INSERT will run)
      mockRun.mockClear();
      mockRun.mockRejectedValue(d1Error);
      try {
        await store.save(snapshot);
      } catch (error) {
        expect(error).toBeInstanceOf(SnapshotWriteError);
        if (error instanceof SnapshotWriteError) {
          expect(error.aggregateType).toBe('account');
          expect(error.aggregateId).toBe('acc-123');
          expect(error.version).toBe(42);
          expect(error.cause).toBe(d1Error);
        }
      }
    });

    it('should resolve to void on successful save', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 1);
      const mockRun = vi.fn().mockResolvedValue(undefined);
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: vi.fn().mockResolvedValue(null),
        bind: vi.fn().mockReturnValue({ run: mockRun, first: vi.fn() }),
      } as unknown as D1PreparedStatement);

      // Act
      const result = await store.save(snapshot);

      // Assert
      expect(result).toBeUndefined();
    });

    it('should not call CREATE TABLE on subsequent saves', async () => {
      // Arrange
      const snapshot1 = createTestSnapshot('account', 'acc-123', 1);
      const snapshot2 = createTestSnapshot('account', 'acc-456', 2);

      const mockRun = vi.fn().mockResolvedValue(undefined);
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: vi.fn().mockResolvedValue(null),
        bind: vi.fn().mockReturnValue({ run: mockRun, first: vi.fn() }),
      } as unknown as D1PreparedStatement);

      // Act
      await store.save(snapshot1);
      vi.mocked(db.prepare).mockClear(); // Clear previous calls
      await store.save(snapshot2);

      // Assert - Only INSERT, no CREATE TABLE
      const createTableCalls = vi
        .mocked(db.prepare)
        .mock.calls.filter((call) => call[0].includes('CREATE TABLE'));
      expect(createTableCalls).toHaveLength(0);
    });
  });

  describe('load()', () => {
    let db: D1Database;
    let store: D1SnapshotStore;

    beforeEach(() => {
      db = createMockD1Database();
      store = new D1SnapshotStore(db);
    });

    it('should create table on first load', async () => {
      // Arrange
      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockResolvedValue(null);
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act
      await store.load('account', 'acc-123');

      // Assert
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS snapshots')
      );
    });

    it('should load snapshot from D1 when it exists', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 42, {
        id: 'acc-123',
        balance: 1500,
      });

      const mockRow = {
        aggregate_type: snapshot.aggregateType,
        aggregate_id: snapshot.aggregateId,
        version: snapshot.version,
        timestamp: snapshot.timestamp,
        state: JSON.stringify(snapshot.state),
      };

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockResolvedValue(mockRow);
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act
      const loaded = await store.load('account', 'acc-123');

      // Assert
      expect(loaded).toEqual(snapshot);
      expect(loaded?.version).toBe(42);
      expect(loaded?.state).toEqual({ id: 'acc-123', balance: 1500 });
    });

    it('should execute correct SELECT query', async () => {
      // Arrange
      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockResolvedValue(null);
      const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: mockFirst });
      vi.mocked(db.prepare).mockReturnValue({
        run: vi.fn().mockResolvedValue(undefined),
        first: vi.fn().mockResolvedValue(null),
        bind: mockBind
      } as unknown as D1PreparedStatement);

      // Act
      await store.load('account', 'acc-123');

      // Assert
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM snapshots')
      );
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE aggregate_type = ? AND aggregate_id = ?')
      );
      expect(mockBind).toHaveBeenCalledWith('account', 'acc-123');
    });

    it('should return null when snapshot does not exist', async () => {
      // Arrange - D1 returns null for missing rows
      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockResolvedValue(null);
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act
      const loaded = await store.load('account', 'acc-999');

      // Assert
      expect(loaded).toBeNull();
    });

    it('should load snapshot for different aggregate types', async () => {
      // Arrange
      const accountSnapshot = createTestSnapshot('account', 'acc-123', 10);
      const userSnapshot = createTestSnapshot('user', 'user-456', 20);

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi
        .fn()
        .mockResolvedValueOnce({
          aggregate_type: 'account',
          aggregate_id: 'acc-123',
          version: 10,
          timestamp: accountSnapshot.timestamp,
          state: JSON.stringify(accountSnapshot.state),
        })
        .mockResolvedValueOnce({
          aggregate_type: 'user',
          aggregate_id: 'user-456',
          version: 20,
          timestamp: userSnapshot.timestamp,
          state: JSON.stringify(userSnapshot.state),
        });

      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act
      const loadedAccount = await store.load('account', 'acc-123');
      const loadedUser = await store.load('user', 'user-456');

      // Assert
      expect(loadedAccount).toEqual(accountSnapshot);
      expect(loadedUser).toEqual(userSnapshot);
    });

    it('should throw SnapshotCorruptedError when JSON parsing fails', async () => {
      // Arrange
      const mockRow = {
        aggregate_type: 'account',
        aggregate_id: 'acc-123',
        version: 42,
        timestamp: '2025-11-14T10:30:00.000Z',
        state: 'invalid json{{{',
      };

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockResolvedValue(mockRow);
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act & Assert
      await expect(store.load('account', 'acc-123')).rejects.toThrow(
        SnapshotCorruptedError
      );
      await expect(store.load('account', 'acc-123')).rejects.toThrow(
        'Snapshot data is corrupted for account/acc-123'
      );

      try {
        await store.load('account', 'acc-123');
      } catch (error) {
        expect(error).toBeInstanceOf(SnapshotCorruptedError);
        if (error instanceof SnapshotCorruptedError) {
          expect(error.aggregateType).toBe('account');
          expect(error.aggregateId).toBe('acc-123');
          expect(error.cause).toBeInstanceOf(Error);
        }
      }
    });

    it('should throw SnapshotStoreError when D1 query fails', async () => {
      // Arrange
      const d1Error = new Error('D1 query failed');
      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockRejectedValue(d1Error);
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act & Assert
      await expect(store.load('account', 'acc-123')).rejects.toThrow(
        SnapshotStoreError
      );
      await expect(store.load('account', 'acc-123')).rejects.toThrow(
        'Failed to load snapshot for account/acc-123'
      );

      try {
        await store.load('account', 'acc-123');
      } catch (error) {
        expect(error).toBeInstanceOf(SnapshotStoreError);
        if (error instanceof SnapshotStoreError) {
          expect(error.aggregateType).toBe('account');
          expect(error.aggregateId).toBe('acc-123');
          expect(error.cause).toBe(d1Error);
        }
      }
    });

    it('should re-throw SnapshotCorruptedError without wrapping', async () => {
      // Arrange
      const mockRow = {
        aggregate_type: 'account',
        aggregate_id: 'acc-123',
        version: 42,
        timestamp: '2025-11-14T10:30:00.000Z',
        state: 'not valid json',
      };

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockResolvedValue(mockRow);
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act & Assert - Should throw SnapshotCorruptedError specifically
      try {
        await store.load('account', 'acc-123');
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SnapshotCorruptedError);
        // Verify it's the specific error type (name check)
        if (error instanceof Error) {
          expect(error.name).toBe('SnapshotCorruptedError');
        }
      }
    });
  });

  describe('ISnapshotStore interface compliance', () => {
    it('should implement all ISnapshotStore methods', () => {
      // Arrange
      const db = createMockD1Database();
      const store = new D1SnapshotStore(db);

      // Assert
      expect(typeof store.save).toBe('function');
      expect(typeof store.load).toBe('function');
    });

    it('should accept correct method signatures', async () => {
      // Arrange
      const db = createMockD1Database();
      const store = new D1SnapshotStore(db);
      const snapshot = createTestSnapshot();

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockResolvedValue(null);
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act & Assert - TypeScript compilation validates signatures
      await expect(store.save(snapshot)).resolves.toBeUndefined();
      await expect(store.load('account', 'acc-123')).resolves.toBeNull();
    });
  });

  describe('edge cases', () => {
    let db: D1Database;
    let store: D1SnapshotStore;

    beforeEach(() => {
      db = createMockD1Database();
      store = new D1SnapshotStore(db);
    });

    it('should handle snapshot with null state', async () => {
      // Arrange - null state is valid (initial empty state)
      const snapshot = createTestSnapshot('account', 'acc-123', 0, null);

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockResolvedValue({
        aggregate_type: 'account',
        aggregate_id: 'acc-123',
        version: 0,
        timestamp: snapshot.timestamp,
        state: 'null',
      });
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act
      await store.save(snapshot);
      const loaded = await store.load('account', 'acc-123');

      // Assert
      expect(loaded?.state).toBeNull();
    });

    it('should handle complex nested state structures', async () => {
      // Arrange
      const complexState = {
        nested: {
          deeply: {
            structured: {
              data: [1, 2, 3],
              map: { a: 'b', c: 'd' },
            },
          },
        },
        array: [{ id: 1 }, { id: 2 }],
        nullValue: null,
        transactions: [
          {
            id: 'tx-1',
            amount: 100,
            metadata: { source: 'api', userId: 'user-1' },
          },
        ],
      };

      const snapshot = createTestSnapshot('account', 'acc-123', 50, complexState);

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: vi.fn() });
      vi.mocked(db.prepare).mockReturnValue({
        run: vi.fn().mockResolvedValue(undefined),
        first: vi.fn().mockResolvedValue(null),
        bind: mockBind
      } as unknown as D1PreparedStatement);

      // Act
      await store.save(snapshot);

      // Assert
      expect(mockBind).toHaveBeenCalledWith(
        'account',
        'acc-123',
        50,
        snapshot.timestamp,
        JSON.stringify(complexState)
      );
    });

    it('should handle aggregateIds with special characters', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123-abc_def', 1);
      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: vi.fn() });
      vi.mocked(db.prepare).mockReturnValue({
        run: vi.fn().mockResolvedValue(undefined),
        first: vi.fn().mockResolvedValue(null),
        bind: mockBind
      } as unknown as D1PreparedStatement);

      // Act
      await store.save(snapshot);

      // Assert
      expect(mockBind).toHaveBeenCalledWith(
        'account',
        'acc-123-abc_def',
        1,
        expect.any(String),
        expect.any(String)
      );
    });

    it('should handle large version numbers', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 999999999);

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockResolvedValue({
        aggregate_type: 'account',
        aggregate_id: 'acc-123',
        version: 999999999,
        timestamp: snapshot.timestamp,
        state: JSON.stringify(snapshot.state),
      });
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act
      await store.save(snapshot);
      const loaded = await store.load('account', 'acc-123');

      // Assert
      expect(loaded?.version).toBe(999999999);
    });

    it('should handle empty state object', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 1, {});

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockResolvedValue({
        aggregate_type: 'account',
        aggregate_id: 'acc-123',
        version: 1,
        timestamp: snapshot.timestamp,
        state: '{}',
      });
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act
      await store.save(snapshot);
      const loaded = await store.load('account', 'acc-123');

      // Assert
      expect(loaded?.state).toEqual({});
    });

    it('should handle very long aggregateType and aggregateId', async () => {
      // Arrange
      const longType = 'very_long_aggregate_type_name_that_might_be_used';
      const longId = 'very-long-aggregate-id-123-456-789-abc-def-ghi-jkl';
      const snapshot = createTestSnapshot(longType, longId, 1);

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: vi.fn() });
      vi.mocked(db.prepare).mockReturnValue({
        run: vi.fn().mockResolvedValue(undefined),
        first: vi.fn().mockResolvedValue(null),
        bind: mockBind
      } as unknown as D1PreparedStatement);

      // Act
      await store.save(snapshot);

      // Assert
      expect(mockBind).toHaveBeenCalledWith(
        longType,
        longId,
        1,
        expect.any(String),
        expect.any(String)
      );
    });

    it('should preserve timestamp precision in snapshot', async () => {
      // Arrange
      const timestamp = '2025-11-14T10:30:45.123Z';
      const snapshot = createTestSnapshot('account', 'acc-123', 1);
      snapshot.timestamp = timestamp;

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockResolvedValue({
        aggregate_type: 'account',
        aggregate_id: 'acc-123',
        version: 1,
        timestamp,
        state: JSON.stringify(snapshot.state),
      });
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act
      await store.save(snapshot);
      const loaded = await store.load('account', 'acc-123');

      // Assert
      expect(loaded?.timestamp).toBe(timestamp);
    });

    it('should handle state with arrays and primitive types', async () => {
      // Arrange
      const state = {
        numbers: [1, 2, 3, 4, 5],
        strings: ['a', 'b', 'c'],
        booleans: [true, false, true],
        mixed: [1, 'two', true, null, { nested: 'object' }],
      };

      const snapshot = createTestSnapshot('account', 'acc-123', 10, state);

      const mockRun = vi.fn().mockResolvedValue(undefined);
      const mockFirst = vi.fn().mockResolvedValue({
        aggregate_type: 'account',
        aggregate_id: 'acc-123',
        version: 10,
        timestamp: snapshot.timestamp,
        state: JSON.stringify(state),
      });
      vi.mocked(db.prepare).mockReturnValue({
        run: mockRun,
        first: mockFirst,
        bind: vi.fn().mockReturnValue({ run: mockRun, first: mockFirst }),
      } as unknown as D1PreparedStatement);

      // Act
      await store.save(snapshot);
      const loaded = await store.load('account', 'acc-123');

      // Assert
      expect(loaded?.state).toEqual(state);
    });
  });
});
