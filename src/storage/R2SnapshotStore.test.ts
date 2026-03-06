/**
 * Unit tests for R2SnapshotStore
 *
 * These tests verify that:
 * 1. R2SnapshotStore correctly implements the ISnapshotStore interface
 * 2. Snapshots are saved to R2 with correct path structure
 * 3. Snapshots are loaded correctly or return null for missing snapshots
 * 4. Latest snapshot wins (idempotent overwrites)
 * 5. Errors are properly wrapped in domain-specific error classes
 * 6. Edge cases are handled correctly (null state, complex structures)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { R2Bucket, R2Object } from '@cloudflare/workers-types';
import { R2SnapshotStore } from './R2SnapshotStore';
import type { StoredSnapshot } from './interfaces';
import {
  SnapshotStoreError,
  SnapshotWriteError,
  SnapshotCorruptedError,
} from './errors';

describe('R2SnapshotStore', () => {
  // Helper to create mock R2Bucket
  function createMockR2Bucket(): R2Bucket {
    return {
      put: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
      head: vi.fn(),
      createMultipartUpload: vi.fn(),
    } as unknown as R2Bucket;
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

  describe('constructor', () => {
    it('should create instance with R2Bucket', () => {
      // Arrange
      const bucket = createMockR2Bucket();

      // Act
      const store = new R2SnapshotStore(bucket);

      // Assert
      expect(store).toBeDefined();
      expect(store).toBeInstanceOf(R2SnapshotStore);
    });
  });

  describe('save()', () => {
    let bucket: R2Bucket;
    let store: R2SnapshotStore;

    beforeEach(() => {
      bucket = createMockR2Bucket();
      store = new R2SnapshotStore(bucket);
    });

    it('should save snapshot to R2 with correct path', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 42);
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act
      await store.save(snapshot);

      // Assert
      expect(bucket.put).toHaveBeenCalledOnce();
      expect(bucket.put).toHaveBeenCalledWith(
        'account/acc-123/snapshot.json',
        JSON.stringify(snapshot)
      );
    });

    it('should serialize snapshot to JSON correctly', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 5, {
        id: 'acc-123',
        balance: 1500,
        currency: 'USD',
        transactions: 42,
      });
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act
      await store.save(snapshot);

      // Assert
      const expectedJson = JSON.stringify(snapshot);
      expect(bucket.put).toHaveBeenCalledWith(
        'account/acc-123/snapshot.json',
        expectedJson
      );

      // Verify the JSON includes all snapshot properties
      const savedJson = vi.mocked(bucket.put).mock.calls[0][1] as string;
      const parsed = JSON.parse(savedJson);
      expect(parsed.aggregateType).toBe('account');
      expect(parsed.aggregateId).toBe('acc-123');
      expect(parsed.version).toBe(5);
      expect(parsed.timestamp).toBe(snapshot.timestamp);
      expect(parsed.state).toEqual(snapshot.state);
    });

    it('should handle different aggregate types', async () => {
      // Arrange
      const accountSnapshot = createTestSnapshot('account', 'acc-123', 1);
      const userSnapshot = createTestSnapshot('user', 'user-456', 1);
      const orderSnapshot = createTestSnapshot('order', 'order-789', 1);

      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act & Assert
      await store.save(accountSnapshot);
      expect(bucket.put).toHaveBeenCalledWith(
        'account/acc-123/snapshot.json',
        expect.any(String)
      );

      await store.save(userSnapshot);
      expect(bucket.put).toHaveBeenCalledWith(
        'user/user-456/snapshot.json',
        expect.any(String)
      );

      await store.save(orderSnapshot);
      expect(bucket.put).toHaveBeenCalledWith(
        'order/order-789/snapshot.json',
        expect.any(String)
      );
    });

    it('should overwrite existing snapshot (latest wins)', async () => {
      // Arrange
      const snapshot1 = createTestSnapshot('account', 'acc-123', 10, {
        balance: 1000,
      });
      const snapshot2 = createTestSnapshot('account', 'acc-123', 20, {
        balance: 2000,
      });

      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act - Save twice to same path
      await store.save(snapshot1);
      await store.save(snapshot2);

      // Assert - Both writes to same path (idempotent overwrites)
      expect(bucket.put).toHaveBeenCalledTimes(2);
      expect(bucket.put).toHaveBeenNthCalledWith(
        1,
        'account/acc-123/snapshot.json',
        JSON.stringify(snapshot1)
      );
      expect(bucket.put).toHaveBeenNthCalledWith(
        2,
        'account/acc-123/snapshot.json',
        JSON.stringify(snapshot2)
      );
    });

    it('should throw SnapshotWriteError when R2 put fails', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 42);
      const r2Error = new Error('R2 unavailable');
      vi.mocked(bucket.put).mockRejectedValue(r2Error);

      // Act & Assert
      await expect(store.save(snapshot)).rejects.toThrow(SnapshotWriteError);
      await expect(store.save(snapshot)).rejects.toThrow(
        'Failed to save snapshot for account/acc-123 v42'
      );

      try {
        await store.save(snapshot);
      } catch (error) {
        expect(error).toBeInstanceOf(SnapshotWriteError);
        if (error instanceof SnapshotWriteError) {
          expect(error.aggregateType).toBe('account');
          expect(error.aggregateId).toBe('acc-123');
          expect(error.version).toBe(42);
          expect(error.cause).toBe(r2Error);
        }
      }
    });

    it('should resolve to void on successful save', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 1);
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act
      const result = await store.save(snapshot);

      // Assert
      expect(result).toBeUndefined();
    });
  });

  describe('load()', () => {
    let bucket: R2Bucket;
    let store: R2SnapshotStore;

    beforeEach(() => {
      bucket = createMockR2Bucket();
      store = new R2SnapshotStore(bucket);
    });

    it('should load snapshot from R2 when it exists', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 42, {
        id: 'acc-123',
        balance: 1500,
      });

      vi.mocked(bucket.get).mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(snapshot)),
      } as R2Object);

      // Act
      const loaded = await store.load('account', 'acc-123');

      // Assert
      expect(bucket.get).toHaveBeenCalledOnce();
      expect(bucket.get).toHaveBeenCalledWith('account/acc-123/snapshot.json');
      expect(loaded).toEqual(snapshot);
      expect(loaded?.version).toBe(42);
      expect(loaded?.state).toEqual({ id: 'acc-123', balance: 1500 });
    });

    it('should return null when snapshot does not exist', async () => {
      // Arrange - R2 returns null for missing objects
      vi.mocked(bucket.get).mockResolvedValue(null);

      // Act
      const loaded = await store.load('account', 'acc-999');

      // Assert
      expect(bucket.get).toHaveBeenCalledOnce();
      expect(bucket.get).toHaveBeenCalledWith('account/acc-999/snapshot.json');
      expect(loaded).toBeNull();
    });

    it('should load snapshot for different aggregate types', async () => {
      // Arrange
      const accountSnapshot = createTestSnapshot('account', 'acc-123', 10);
      const userSnapshot = createTestSnapshot('user', 'user-456', 20);

      vi.mocked(bucket.get)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(accountSnapshot)),
        } as R2Object)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(userSnapshot)),
        } as R2Object);

      // Act
      const loadedAccount = await store.load('account', 'acc-123');
      const loadedUser = await store.load('user', 'user-456');

      // Assert
      expect(bucket.get).toHaveBeenCalledWith('account/acc-123/snapshot.json');
      expect(bucket.get).toHaveBeenCalledWith('user/user-456/snapshot.json');
      expect(loadedAccount).toEqual(accountSnapshot);
      expect(loadedUser).toEqual(userSnapshot);
    });

    it('should throw SnapshotCorruptedError when JSON parsing fails', async () => {
      // Arrange
      vi.mocked(bucket.get).mockResolvedValue({
        text: () => Promise.resolve('invalid json{{{'),
      } as R2Object);

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

    it('should throw SnapshotStoreError when R2 get fails', async () => {
      // Arrange
      const r2Error = new Error('R2 get failed');
      vi.mocked(bucket.get).mockRejectedValue(r2Error);

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
          expect(error.cause).toBe(r2Error);
        }
      }
    });

    it('should re-throw SnapshotCorruptedError without wrapping', async () => {
      // Arrange
      vi.mocked(bucket.get).mockResolvedValue({
        text: () => Promise.resolve('not valid json'),
      } as R2Object);

      // Act & Assert - Should throw SnapshotCorruptedError specifically (not wrapped)
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
      const bucket = createMockR2Bucket();
      const store = new R2SnapshotStore(bucket);

      // Assert
      expect(typeof store.save).toBe('function');
      expect(typeof store.load).toBe('function');
    });

    it('should accept correct method signatures', async () => {
      // Arrange
      const bucket = createMockR2Bucket();
      const store = new R2SnapshotStore(bucket);
      const snapshot = createTestSnapshot();

      vi.mocked(bucket.put).mockResolvedValue(undefined as never);
      vi.mocked(bucket.get).mockResolvedValue(null);

      // Act & Assert - TypeScript compilation validates signatures
      await expect(store.save(snapshot)).resolves.toBeUndefined();
      await expect(store.load('account', 'acc-123')).resolves.toBeNull();
    });
  });

  describe('edge cases', () => {
    let bucket: R2Bucket;
    let store: R2SnapshotStore;

    beforeEach(() => {
      bucket = createMockR2Bucket();
      store = new R2SnapshotStore(bucket);
    });

    it('should handle snapshot with null state', async () => {
      // Arrange - null state is valid (initial empty state)
      const snapshot = createTestSnapshot('account', 'acc-123', 0, null);
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);
      vi.mocked(bucket.get).mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(snapshot)),
      } as R2Object);

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
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act
      await store.save(snapshot);

      // Assert
      const savedJson = vi.mocked(bucket.put).mock.calls[0][1] as string;
      const parsed = JSON.parse(savedJson);
      expect(parsed.state).toEqual(complexState);
    });

    it('should handle aggregateIds with special characters', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123-abc_def', 1);
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act
      await store.save(snapshot);

      // Assert
      expect(bucket.put).toHaveBeenCalledWith(
        'account/acc-123-abc_def/snapshot.json',
        expect.any(String)
      );
    });

    it('should handle large version numbers', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 999999999);
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);
      vi.mocked(bucket.get).mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(snapshot)),
      } as R2Object);

      // Act
      await store.save(snapshot);
      const loaded = await store.load('account', 'acc-123');

      // Assert
      expect(loaded?.version).toBe(999999999);
    });

    it('should handle empty state object', async () => {
      // Arrange
      const snapshot = createTestSnapshot('account', 'acc-123', 1, {});
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);
      vi.mocked(bucket.get).mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(snapshot)),
      } as R2Object);

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
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act
      await store.save(snapshot);

      // Assert
      expect(bucket.put).toHaveBeenCalledWith(
        `${longType}/${longId}/snapshot.json`,
        expect.any(String)
      );
    });

    it('should preserve timestamp precision in snapshot', async () => {
      // Arrange
      const timestamp = '2025-11-14T10:30:45.123Z';
      const snapshot = createTestSnapshot('account', 'acc-123', 1);
      snapshot.timestamp = timestamp;

      vi.mocked(bucket.put).mockResolvedValue(undefined as never);
      vi.mocked(bucket.get).mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(snapshot)),
      } as R2Object);

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
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);
      vi.mocked(bucket.get).mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(snapshot)),
      } as R2Object);

      // Act
      await store.save(snapshot);
      const loaded = await store.load('account', 'acc-123');

      // Assert
      expect(loaded?.state).toEqual(state);
    });
  });
});
