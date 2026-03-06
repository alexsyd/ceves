/**
 * Unit tests for R2EventStore
 *
 * These tests verify that:
 * 1. R2EventStore correctly implements the IEventStore interface
 * 2. Events are saved to R2 with correct path structure and zero-padding
 * 3. Events are loaded with proper filtering and ordering
 * 4. Errors are properly wrapped in domain-specific error classes
 * 5. Edge cases are handled correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { R2Bucket, R2Object, R2Objects } from '@cloudflare/workers-types';
import { R2EventStore } from './R2EventStore';
import type { StoredEvent } from './interfaces';
import { EventStoreError, EventWriteError } from './errors';

describe('R2EventStore', () => {
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

  // Helper to create test event
  function createTestEvent(
    aggregateType = 'account',
    aggregateId = 'acc-123',
    version = 1,
    type = 'AccountCreated'
  ): StoredEvent {
    return {
      aggregateType,
      aggregateId,
      version,
      type,
      timestamp: '2025-11-14T10:30:00.000Z',
      data: { test: true },
    };
  }

  describe('constructor', () => {
    it('should create instance with R2Bucket', () => {
      // Arrange
      const bucket = createMockR2Bucket();

      // Act
      const store = new R2EventStore(bucket);

      // Assert
      expect(store).toBeDefined();
      expect(store).toBeInstanceOf(R2EventStore);
    });
  });

  describe('save()', () => {
    let bucket: R2Bucket;
    let store: R2EventStore;

    beforeEach(() => {
      bucket = createMockR2Bucket();
      store = new R2EventStore(bucket);
    });

    it('should save event to R2 with correct path and zero-padded version', async () => {
      // Arrange
      const event = createTestEvent('account', 'acc-123', 1);
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act
      await store.save(event);

      // Assert
      expect(bucket.put).toHaveBeenCalledOnce();
      expect(bucket.put).toHaveBeenCalledWith(
        'account/acc-123/000000001.json',
        JSON.stringify(event)
      );
    });

    it('should zero-pad version to 9 digits', async () => {
      // Arrange
      const testCases = [
        { version: 1, expected: '000000001' },
        { version: 42, expected: '000000042' },
        { version: 1337, expected: '000001337' },
        { version: 999999999, expected: '999999999' },
      ];

      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act & Assert
      for (const { version, expected } of testCases) {
        const event = createTestEvent('account', 'acc-123', version);
        await store.save(event);

        expect(bucket.put).toHaveBeenCalledWith(
          `account/acc-123/${expected}.json`,
          expect.any(String)
        );
      }
    });

    it('should serialize event to JSON correctly', async () => {
      // Arrange
      const event = createTestEvent('account', 'acc-123', 5);
      event.data = { balance: 1500, currency: 'USD' };
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act
      await store.save(event);

      // Assert
      const expectedJson = JSON.stringify(event);
      expect(bucket.put).toHaveBeenCalledWith(
        'account/acc-123/000000005.json',
        expectedJson
      );
    });

    it('should handle different aggregate types', async () => {
      // Arrange
      const accountEvent = createTestEvent('account', 'acc-123', 1);
      const userEvent = createTestEvent('user', 'user-456', 1);
      const orderEvent = createTestEvent('order', 'order-789', 1);

      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act & Assert
      await store.save(accountEvent);
      expect(bucket.put).toHaveBeenCalledWith(
        'account/acc-123/000000001.json',
        expect.any(String)
      );

      await store.save(userEvent);
      expect(bucket.put).toHaveBeenCalledWith(
        'user/user-456/000000001.json',
        expect.any(String)
      );

      await store.save(orderEvent);
      expect(bucket.put).toHaveBeenCalledWith(
        'order/order-789/000000001.json',
        expect.any(String)
      );
    });

    it('should throw EventWriteError when R2 put fails', async () => {
      // Arrange
      const event = createTestEvent('account', 'acc-123', 1);
      const r2Error = new Error('R2 unavailable');
      vi.mocked(bucket.put).mockRejectedValue(r2Error);

      // Act & Assert
      await expect(store.save(event)).rejects.toThrow(EventWriteError);
      await expect(store.save(event)).rejects.toThrow(
        'Failed to save event for account/acc-123 v1'
      );

      try {
        await store.save(event);
      } catch (error) {
        expect(error).toBeInstanceOf(EventWriteError);
        if (error instanceof EventWriteError) {
          expect(error.aggregateType).toBe('account');
          expect(error.aggregateId).toBe('acc-123');
          expect(error.version).toBe(1);
          expect(error.cause).toBe(r2Error);
        }
      }
    });

    it('should resolve to void on successful save', async () => {
      // Arrange
      const event = createTestEvent('account', 'acc-123', 1);
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act
      const result = await store.save(event);

      // Assert
      expect(result).toBeUndefined();
    });
  });

  describe('load()', () => {
    let bucket: R2Bucket;
    let store: R2EventStore;

    beforeEach(() => {
      bucket = createMockR2Bucket();
      store = new R2EventStore(bucket);
    });

    it('should load all events for an aggregate', async () => {
      // Arrange
      const event1 = createTestEvent('account', 'acc-123', 1, 'AccountCreated');
      const event2 = createTestEvent('account', 'acc-123', 2, 'MoneyDeposited');
      const event3 = createTestEvent('account', 'acc-123', 3, 'MoneyWithdrawn');

      const mockObjects: R2Object[] = [
        { key: 'account/acc-123/000000001.json' } as R2Object,
        { key: 'account/acc-123/000000002.json' } as R2Object,
        { key: 'account/acc-123/000000003.json' } as R2Object,
      ];

      vi.mocked(bucket.list).mockResolvedValue({
        objects: mockObjects,
      } as R2Objects);

      vi.mocked(bucket.get)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event1)),
        } as R2Object)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event2)),
        } as R2Object)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event3)),
        } as R2Object);

      // Act
      const events = await store.load('account', 'acc-123');

      // Assert
      expect(bucket.list).toHaveBeenCalledOnce();
      expect(bucket.list).toHaveBeenCalledWith({ prefix: 'account/acc-123/' });
      expect(events).toHaveLength(3);
      expect(events[0]).toEqual(event1);
      expect(events[1]).toEqual(event2);
      expect(events[2]).toEqual(event3);
    });

    it('should filter events by afterVersion', async () => {
      // Arrange
      const mockObjects: R2Object[] = [
        { key: 'account/acc-123/000000001.json' } as R2Object,
        { key: 'account/acc-123/000000002.json' } as R2Object,
        { key: 'account/acc-123/000000011.json' } as R2Object,
        { key: 'account/acc-123/000000012.json' } as R2Object,
      ];

      const event11 = createTestEvent('account', 'acc-123', 11, 'Event11');
      const event12 = createTestEvent('account', 'acc-123', 12, 'Event12');

      vi.mocked(bucket.list).mockResolvedValue({
        objects: mockObjects,
      } as R2Objects);

      vi.mocked(bucket.get)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event11)),
        } as R2Object)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event12)),
        } as R2Object);

      // Act
      const events = await store.load('account', 'acc-123', 10);

      // Assert
      expect(events).toHaveLength(2);
      expect(events[0].version).toBe(11);
      expect(events[1].version).toBe(12);
      expect(bucket.get).toHaveBeenCalledTimes(2);
      expect(bucket.get).toHaveBeenCalledWith('account/acc-123/000000011.json');
      expect(bucket.get).toHaveBeenCalledWith('account/acc-123/000000012.json');
    });

    it('should return events in ascending version order', async () => {
      // Arrange - Events returned out of order from R2
      const event1 = createTestEvent('account', 'acc-123', 1);
      const event2 = createTestEvent('account', 'acc-123', 2);
      const event3 = createTestEvent('account', 'acc-123', 3);

      const mockObjects: R2Object[] = [
        { key: 'account/acc-123/000000003.json' } as R2Object,
        { key: 'account/acc-123/000000001.json' } as R2Object,
        { key: 'account/acc-123/000000002.json' } as R2Object,
      ];

      vi.mocked(bucket.list).mockResolvedValue({
        objects: mockObjects,
      } as R2Objects);

      vi.mocked(bucket.get)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event3)),
        } as R2Object)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event1)),
        } as R2Object)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event2)),
        } as R2Object);

      // Act
      const events = await store.load('account', 'acc-123');

      // Assert - Events should be sorted by version
      expect(events).toHaveLength(3);
      expect(events[0].version).toBe(1);
      expect(events[1].version).toBe(2);
      expect(events[2].version).toBe(3);
    });

    it('should return empty array when no events exist', async () => {
      // Arrange
      vi.mocked(bucket.list).mockResolvedValue({
        objects: [],
      } as R2Objects);

      // Act
      const events = await store.load('account', 'acc-999');

      // Assert
      expect(events).toEqual([]);
      expect(bucket.get).not.toHaveBeenCalled();
    });

    it('should return empty array when all events filtered by afterVersion', async () => {
      // Arrange
      const mockObjects: R2Object[] = [
        { key: 'account/acc-123/000000001.json' } as R2Object,
        { key: 'account/acc-123/000000002.json' } as R2Object,
      ];

      vi.mocked(bucket.list).mockResolvedValue({
        objects: mockObjects,
      } as R2Objects);

      // Act
      const events = await store.load('account', 'acc-123', 100);

      // Assert
      expect(events).toEqual([]);
      expect(bucket.get).not.toHaveBeenCalled();
    });

    it('should skip objects that are deleted between list and get', async () => {
      // Arrange
      const event1 = createTestEvent('account', 'acc-123', 1);

      const mockObjects: R2Object[] = [
        { key: 'account/acc-123/000000001.json' } as R2Object,
        { key: 'account/acc-123/000000002.json' } as R2Object,
      ];

      vi.mocked(bucket.list).mockResolvedValue({
        objects: mockObjects,
      } as R2Objects);

      // First get succeeds, second returns null (deleted)
      vi.mocked(bucket.get)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event1)),
        } as R2Object)
        .mockResolvedValueOnce(null);

      // Act
      const events = await store.load('account', 'acc-123');

      // Assert
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event1);
    });

    it('should throw EventStoreError when R2 list fails', async () => {
      // Arrange
      const r2Error = new Error('R2 list failed');
      vi.mocked(bucket.list).mockRejectedValue(r2Error);

      // Act & Assert
      await expect(store.load('account', 'acc-123')).rejects.toThrow(
        EventStoreError
      );
      await expect(store.load('account', 'acc-123')).rejects.toThrow(
        'Failed to load events for account/acc-123'
      );

      try {
        await store.load('account', 'acc-123');
      } catch (error) {
        expect(error).toBeInstanceOf(EventStoreError);
        if (error instanceof EventStoreError) {
          expect(error.aggregateType).toBe('account');
          expect(error.aggregateId).toBe('acc-123');
          expect(error.cause).toBe(r2Error);
        }
      }
    });

    it('should throw EventStoreError when R2 get fails', async () => {
      // Arrange
      const mockObjects: R2Object[] = [
        { key: 'account/acc-123/000000001.json' } as R2Object,
      ];

      vi.mocked(bucket.list).mockResolvedValue({
        objects: mockObjects,
      } as R2Objects);

      const r2Error = new Error('R2 get failed');
      vi.mocked(bucket.get).mockRejectedValue(r2Error);

      // Act & Assert
      await expect(store.load('account', 'acc-123')).rejects.toThrow(
        EventStoreError
      );
    });

    it('should throw EventStoreError when JSON parsing fails', async () => {
      // Arrange
      const mockObjects: R2Object[] = [
        { key: 'account/acc-123/000000001.json' } as R2Object,
      ];

      vi.mocked(bucket.list).mockResolvedValue({
        objects: mockObjects,
      } as R2Objects);

      vi.mocked(bucket.get).mockResolvedValueOnce({
        text: () => Promise.resolve('invalid json{{{'),
      } as R2Object);

      // Act & Assert
      await expect(store.load('account', 'acc-123')).rejects.toThrow(
        EventStoreError
      );
    });
  });

  describe('loadAll()', () => {
    let bucket: R2Bucket;
    let store: R2EventStore;

    beforeEach(() => {
      bucket = createMockR2Bucket();
      store = new R2EventStore(bucket);
    });

    it('should call load() without afterVersion parameter', async () => {
      // Arrange
      const event1 = createTestEvent('account', 'acc-123', 1);
      const event2 = createTestEvent('account', 'acc-123', 2);

      const mockObjects: R2Object[] = [
        { key: 'account/acc-123/000000001.json' } as R2Object,
        { key: 'account/acc-123/000000002.json' } as R2Object,
      ];

      vi.mocked(bucket.list).mockResolvedValue({
        objects: mockObjects,
      } as R2Objects);

      vi.mocked(bucket.get)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event1)),
        } as R2Object)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event2)),
        } as R2Object);

      // Act
      const events = await store.loadAll('account', 'acc-123');

      // Assert
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(event1);
      expect(events[1]).toEqual(event2);
      expect(bucket.list).toHaveBeenCalledWith({ prefix: 'account/acc-123/' });
    });

    it('should return all events without filtering', async () => {
      // Arrange
      const mockObjects: R2Object[] = [
        { key: 'account/acc-123/000000001.json' } as R2Object,
        { key: 'account/acc-123/000000042.json' } as R2Object,
        { key: 'account/acc-123/000001337.json' } as R2Object,
      ];

      const event1 = createTestEvent('account', 'acc-123', 1);
      const event42 = createTestEvent('account', 'acc-123', 42);
      const event1337 = createTestEvent('account', 'acc-123', 1337);

      vi.mocked(bucket.list).mockResolvedValue({
        objects: mockObjects,
      } as R2Objects);

      vi.mocked(bucket.get)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event1)),
        } as R2Object)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event42)),
        } as R2Object)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event1337)),
        } as R2Object);

      // Act
      const events = await store.loadAll('account', 'acc-123');

      // Assert
      expect(events).toHaveLength(3);
      expect(events[0].version).toBe(1);
      expect(events[1].version).toBe(42);
      expect(events[2].version).toBe(1337);
    });
  });

  describe('IEventStore interface compliance', () => {
    it('should implement all IEventStore methods', () => {
      // Arrange
      const bucket = createMockR2Bucket();
      const store = new R2EventStore(bucket);

      // Assert
      expect(typeof store.save).toBe('function');
      expect(typeof store.load).toBe('function');
      expect(typeof store.loadAll).toBe('function');
    });

    it('should accept correct method signatures', async () => {
      // Arrange
      const bucket = createMockR2Bucket();
      const store = new R2EventStore(bucket);
      const event = createTestEvent();

      vi.mocked(bucket.put).mockResolvedValue(undefined as never);
      vi.mocked(bucket.list).mockResolvedValue({ objects: [] } as R2Objects);

      // Act & Assert - TypeScript compilation validates signatures
      await expect(store.save(event)).resolves.toBeUndefined();
      await expect(store.load('account', 'acc-123')).resolves.toEqual([]);
      await expect(store.load('account', 'acc-123', 10)).resolves.toEqual([]);
      await expect(store.loadAll('account', 'acc-123')).resolves.toEqual([]);
    });
  });

  describe('edge cases', () => {
    let bucket: R2Bucket;
    let store: R2EventStore;

    beforeEach(() => {
      bucket = createMockR2Bucket();
      store = new R2EventStore(bucket);
    });

    it('should handle complex data structures in events', async () => {
      // Arrange
      const event = createTestEvent('account', 'acc-123', 1);
      event.data = {
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
      };

      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act
      await store.save(event);

      // Assert
      const savedJson = vi.mocked(bucket.put).mock.calls[0][1] as string;
      const parsed = JSON.parse(savedJson);
      expect(parsed.data).toEqual(event.data);
    });

    it('should handle aggregateIds with special characters', async () => {
      // Arrange
      const event = createTestEvent('account', 'acc-123-abc_def', 1);
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act
      await store.save(event);

      // Assert
      expect(bucket.put).toHaveBeenCalledWith(
        'account/acc-123-abc_def/000000001.json',
        expect.any(String)
      );
    });

    it('should handle large version numbers', async () => {
      // Arrange
      const event = createTestEvent('account', 'acc-123', 123456789);
      vi.mocked(bucket.put).mockResolvedValue(undefined as never);

      // Act
      await store.save(event);

      // Assert
      expect(bucket.put).toHaveBeenCalledWith(
        'account/acc-123/123456789.json',
        expect.any(String)
      );
    });

    it('should handle afterVersion = 0', async () => {
      // Arrange
      const mockObjects: R2Object[] = [
        { key: 'account/acc-123/000000001.json' } as R2Object,
        { key: 'account/acc-123/000000002.json' } as R2Object,
      ];

      const event1 = createTestEvent('account', 'acc-123', 1);
      const event2 = createTestEvent('account', 'acc-123', 2);

      vi.mocked(bucket.list).mockResolvedValue({
        objects: mockObjects,
      } as R2Objects);

      vi.mocked(bucket.get)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event1)),
        } as R2Object)
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(event2)),
        } as R2Object);

      // Act
      const events = await store.load('account', 'acc-123', 0);

      // Assert - Should return events with version > 0 (all events)
      expect(events).toHaveLength(2);
    });
  });
});
